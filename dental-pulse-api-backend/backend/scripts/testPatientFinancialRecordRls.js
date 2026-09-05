/**
 * RLS + URL-manipulation tests for v_patient_financial_record.
 *
 * Confirms a patient financial record cannot be read across practices via
 * direct patient_id manipulation (app-layer filter) and that rows only exist
 * for the patient's owning practice_id.
 *
 * Usage:
 *   node backend/scripts/testPatientFinancialRecordRls.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { supabaseAdmin } = require('../config/supabase');

const VIEW = 'v_patient_financial_record';

async function pickTwoPractices() {
  const { data, error } = await supabaseAdmin.from(VIEW).select('practice_id').limit(5000);
  if (error) throw error;
  const counts = new Map();
  for (const row of data || []) {
    counts.set(row.practice_id, (counts.get(row.practice_id) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length < 2) {
    throw new Error('Need at least two practices with financial record rows to test cross-practice access.');
  }
  return { practiceA: sorted[0][0], practiceB: sorted[1][0] };
}

async function pickPatient(practiceId) {
  const { data, error } = await supabaseAdmin
    .from(VIEW)
    .select('patient_id, practice_id, patient_name, contribution, cltv_projection')
    .eq('practice_id', practiceId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No row for practice ${practiceId}`);
  return data;
}

async function main() {
  console.log('v_patient_financial_record RLS / cross-practice tests\n');

  const { practiceA, practiceB } = await pickTwoPractices();
  const patientB = await pickPatient(practiceB);
  const patientA = await pickPatient(practiceA);

  console.log(`Practice A: ${practiceA}`);
  console.log(`Practice B: ${practiceB}`);
  console.log(`Patient B: ${patientB.patient_id} (${patientB.patient_name})\n`);

  // 1) App-layer URL attack: user's org A + foreign patient_id from B → no row
  const { data: wrongGrain, error: wrongGrainErr } = await supabaseAdmin
    .from(VIEW)
    .select('patient_id, practice_id, contribution')
    .eq('practice_id', practiceA)
    .eq('patient_id', patientB.patient_id)
    .maybeSingle();

  if (wrongGrainErr) throw wrongGrainErr;
  const grainOk = wrongGrain == null;
  console.log(
    grainOk
      ? '✓ Cross-practice URL simulation (practice_id=A, patient_id=B): 0 rows'
      : '✗ LEAK: matched row with wrong practice_id filter',
  );
  if (!grainOk) {
    console.log('  Returned:', wrongGrain);
    process.exitCode = 1;
  }

  // 2) Row grain: patient B's record is always tagged with practice B
  const { data: rowB, error: rowBErr } = await supabaseAdmin
    .from(VIEW)
    .select('practice_id, patient_id')
    .eq('patient_id', patientB.patient_id)
    .maybeSingle();

  if (rowBErr) throw rowBErr;
  const grainMatch = rowB?.practice_id === practiceB;
  console.log(
    grainMatch
      ? '✓ Patient row practice_id matches owning practice'
      : `✗ practice_id mismatch: row=${rowB?.practice_id} expected=${practiceB}`,
  );
  if (!grainMatch) process.exitCode = 1;

  // 3) Same-practice lookup succeeds
  const { data: rowA, error: rowAErr } = await supabaseAdmin
    .from(VIEW)
    .select('patient_id, practice_id, patient_economic_value, recommended_action')
    .eq('practice_id', practiceA)
    .eq('patient_id', patientA.patient_id)
    .maybeSingle();

  if (rowAErr) throw rowAErr;
  console.log(
    rowA
      ? `✓ Same-practice lookup returned record (PEV=${rowA.patient_economic_value}, action=${rowA.recommended_action})`
      : '✗ Same-practice lookup failed unexpectedly',
  );
  if (!rowA) process.exitCode = 1;

  console.log('\nNote: authenticated JWT RLS is enforced via security_invoker on');
  console.log('v_invoice_contribution + patient_economics_modelled_scores policies.');
  console.log('This script validates grain + app-layer filters with service_role.');

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((err) => {
  if (err.code === '42P01') {
    console.error('View not found — apply migration 20260828150001 first.');
  } else {
    console.error(err);
  }
  process.exit(1);
});
