/**
 * Economic Pulse hero — fast invoice + UDA lens only.
 * Cards 2–5 load via separate read endpoints (leakage, retention, growth).
 */

const { withPeReadCache } = require('./peReadCache');
const { getInvoiceContributionSummary } = require('./patientEconomicsRead');

/**
 * @param {string} practiceId
 * @param {{ locationId?: string | null, startDate?: string | null, endDate?: string | null }} [scope]
 */
async function getEconomicPulseHero(practiceId, scope = {}) {
  const { scopeCacheExtra } = require('./peReadScope');
  return withPeReadCache(
    'economic-pulse-hero',
    practiceId,
    async () => {
      const invoiceSummary = await getInvoiceContributionSummary(practiceId, scope);
      return {
        practiceId,
        invoiceSummary,
      };
    },
    { ttlMs: 120_000, extra: scopeCacheExtra(scope) },
  );
}

module.exports = {
  getEconomicPulseHero,
};
