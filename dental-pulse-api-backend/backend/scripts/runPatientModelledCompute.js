/**
 * Run Modelled-tier CLTV + Quality Score compute for one practice (or auto-pick).
 *
 * Usage:
 *   node backend/scripts/runPatientModelledCompute.js [practice_id]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { supabaseAdmin } = require('../config/supabase');
const {
  computeModelledScoresForPractice,
} = require('../services/patientEconomics/computePatientModelledScores');

async function resolvePracticeId(arg) {
  if (arg) return arg;
  const { data, error } = await supabaseAdmin
    .from('v_patient_contribution')
    .select('practice_id')
    .limit(5000);
  if (error) throw error;
  const counts = new Map();
  for (const row of data || []) {
    counts.set(row.practice_id, (counts.get(row.practice_id) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

async function main() {
  const practiceId = await resolvePracticeId(process.argv[2]);
  if (!practiceId) {
    console.error('No practice with contribution data found.');
    process.exit(1);
  }

  console.log(`Computing modelled scores for practice ${practiceId}…`);
  const result = await computeModelledScoresForPractice(practiceId);
  console.log(JSON.stringify(result, null, 2));

  const { count, error } = await supabaseAdmin
    .from('patient_economics_modelled_scores')
    .select('*', { count: 'exact', head: true })
    .eq('practice_id', practiceId);
  if (error) throw error;

  const { data: sample } = await supabaseAdmin
    .from('patient_economics_modelled_scores')
    .select(
      'patient_id, cltv_projection, quality_score, cltv_tier, quality_score_tier, confidence_score, computed_at',
    )
    .eq('practice_id', practiceId)
    .order('cltv_projection', { ascending: false })
    .limit(3);

  console.log(`Table row count for practice: ${count}`);
  console.log('Top 3 by CLTV:', JSON.stringify(sample, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
