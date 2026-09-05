/**
 * Practice margin % from materialized facts or live rollup (pe_practice_contribution_row RPC).
 */

const { supabaseAdmin } = require('../../config/supabase');

async function loadPracticeMarginPct(practiceId) {
  const { data, error } = await supabaseAdmin.rpc('pe_practice_contribution_row', {
    p_practice_id: practiceId,
  });

  if (error) return null;

  const row = data && typeof data === 'object' ? data : {};
  const pct = Number(row.margin_pct);
  if (Number.isFinite(pct) && pct > 0) return pct;

  const rev = Number(row.revenue_private_plan);
  const contrib = Number(row.contribution);
  if (rev > 0 && contrib > 0) return Math.round((contrib / rev) * 1000) / 10;

  return null;
}

module.exports = {
  loadPracticeMarginPct,
};
