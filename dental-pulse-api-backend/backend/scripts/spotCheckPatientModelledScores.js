/**
 * Spot-check patient_economics_modelled_scores after compute job.
 *
 * Usage:
 *   node backend/scripts/spotCheckPatientModelledScores.js [practice_id]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { supabaseAdmin } = require('../config/supabase');

async function resolvePracticeId(arg) {
  if (arg) return { practiceId: arg, count: null };
  const { data, error } = await supabaseAdmin
    .from('patient_economics_modelled_scores')
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
  return { practiceId: best, count: bestN };
}

async function main() {
  const arg = process.argv[2];
  const practiceId = arg
    ? arg
    : (await resolvePracticeId(null)).practiceId;
  if (!practiceId) {
    console.log('No modelled scores in table yet.');
    process.exit(1);
  }

  const { count, error } = await supabaseAdmin
    .from('patient_economics_modelled_scores')
    .select('*', { count: 'exact', head: true })
    .eq('practice_id', practiceId);
  if (error) throw error;

  const { data: agg, error: aggErr } = await supabaseAdmin
    .from('patient_economics_modelled_scores')
    .select('cltv_projection, quality_score, confidence_score, cltv_tier, quality_score_tier')
    .eq('practice_id', practiceId);
  if (aggErr) throw aggErr;

  const rows = agg || [];
  const avgCltv =
    rows.length > 0
      ? rows.reduce((s, r) => s + Number(r.cltv_projection), 0) / rows.length
      : 0;
  const avgQuality =
    rows.length > 0
      ? rows.reduce((s, r) => s + Number(r.quality_score), 0) / rows.length
      : 0;
  const allModelled =
    rows.length > 0 &&
    rows.every(
      (r) => r.cltv_tier === 'Modelled' && r.quality_score_tier === 'Modelled',
    );

  const { count: contribCount } = await supabaseAdmin
    .from('v_patient_contribution')
    .select('*', { count: 'exact', head: true })
    .eq('practice_id', practiceId);

  console.log('Practice:', practiceId);
  console.log('Modelled scores rows:', count);
  console.log('v_patient_contribution rows:', contribCount);
  console.log('Avg CLTV projection:', avgCltv.toFixed(2));
  console.log('Avg quality score:', avgQuality.toFixed(1));
  console.log('All tiers Modelled:', allModelled ? 'YES' : 'NO');
  console.log(count === contribCount ? 'PASS — counts match contribution rollup' : 'WARN — counts differ');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
