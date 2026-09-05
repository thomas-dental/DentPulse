/**
 * Chunked refresh of PE contribution fact tables for one practice.
 *
 * Usage:
 *   node backend/scripts/refreshPeContributionFacts.js <practice_id>
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const {
  refreshPeContributionFacts,
} = require('../services/patientEconomics/refreshPeContributionFacts');
const { supabaseAdmin } = require('../config/supabase');

async function main() {
  const practiceId = process.argv[2];
  if (!practiceId) {
    console.error('Usage: node backend/scripts/refreshPeContributionFacts.js <practice_id>');
    process.exit(1);
  }

  const start = Date.now();
  const result = await refreshPeContributionFacts(practiceId);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  const tables = [
    'pe_invoice_contribution_facts',
    'pe_patient_contribution_facts',
    'pe_practice_contribution_facts',
  ];

  for (const table of tables) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('practice_id', practiceId);
    console.log(`${table}: ${error ? error.message : count}`);
  }

  console.log(
    JSON.stringify({
      success: true,
      practiceId,
      invoiceFactsUpserted: result.invoiceCount,
      patientFactsUpserted: result.patientCount,
      elapsedSeconds: Number(elapsed),
    }),
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
