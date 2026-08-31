/**
 * Spot-check Value & Leakage summary against real ledger data.
 *
 * Usage: node backend/scripts/spotCheckValueLeakageSummary.js <practiceId>
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getValueLeakageSummary } = require('../services/patientEconomics/valueLeakageSummary');
const { getPlannedUnscheduledLeakage } = require('../services/patientEconomics/plannedUnscheduledLeakage');

async function main() {
  const practiceId = process.argv[2];
  if (!practiceId) {
    console.error('Usage: node spotCheckValueLeakageSummary.js <practiceId>');
    process.exit(1);
  }

  const summary = await getValueLeakageSummary(practiceId);
  const leakage = await getPlannedUnscheduledLeakage(practiceId);

  console.log('\n=== Value & Leakage summary ===');
  console.log('Gross opportunity:', summary.opportunityGross);
  console.log('Weighted opportunity:', summary.opportunityWeighted);
  console.log('Commitment 30d:', Math.round(summary.commitmentRate30d * 100) + '%');
  console.log('By window:', summary.byWindow.map((w) => `${w.windowDays}d=${Math.round(w.commitmentRate * 100)}%`).join(', '));
  console.log('By clinician:', summary.byClinician.length, 'rows');
  for (const row of summary.byClinician.slice(0, 5)) {
    console.log(
      `  ${row.practitionerName}: ${Math.round(row.commitmentRate * 100)}% · £${row.totalEligibleValue}`,
    );
  }
  console.log('\n=== Planned unscheduled leakage ===');
  console.log('Items:', leakage.itemCount, '· £ at risk:', leakage.totalValueAtRisk);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
