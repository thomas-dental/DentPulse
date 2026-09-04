/**
 * Check whether synced PE data exists for a calendar period (TopBar date filter).
 */

const { supabaseAdmin } = require('../../../config/supabase');
const { getPracticeSyncRange } = require('./practiceSyncRange');
const { SCHEDULED_RESOURCE_TYPES, hasActiveInProgress } = require('./cursorStore');
const { loadPatientUuidsForLocation } = require('../peLocationScope');
const { sumCountInPatientChunks } = require('../pePatientQueryChunks');

const DATE_WINDOW_RESOURCES = new Set([
  'patients',
  'recalls',
  'appointments',
  'treatment_appointments',
  'treatment_plans',
  'treatment_items',
  'invoices',
  'payments',
]);

const STALE_MS = Number(process.env.PE_SYNC_IN_PROGRESS_STALE_MS || 120_000);

function isYmd(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function countInvoicesInPeriod(practiceId, startDate, endDate, locationId) {
  let query = supabaseAdmin
    .from('platform_integration_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', practiceId)
    .eq('platform_type', 'dentally')
    .gte('invoice_date', startDate)
    .lte('invoice_date', endDate);

  if (locationId) {
    query = query.eq('location_id', locationId);
  }

  const { count, error } = await query;
  if (error) throw new Error(`invoice period count: ${error.message}`);
  return count ?? 0;
}

async function countLedgerInPeriod(practiceId, startDate, endDate, locationId) {
  if (locationId) {
    const patientIds = await loadPatientUuidsForLocation(practiceId, locationId);
    if (patientIds.length === 0) return 0;

    return sumCountInPatientChunks(patientIds, async (chunk) => {
      const { count, error } = await supabaseAdmin
        .from('event_ledger')
        .select('id', { count: 'exact', head: true })
        .eq('practice_id', practiceId)
        .gte('created_at', `${startDate}T00:00:00.000Z`)
        .lte('created_at', `${endDate}T23:59:59.999Z`)
        .in('patient_id', chunk);
      return { count, error };
    });
  }

  const { count, error } = await supabaseAdmin
    .from('event_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .gte('created_at', `${startDate}T00:00:00.000Z`)
    .lte('created_at', `${endDate}T23:59:59.999Z`);

  if (error) throw new Error(`ledger period count: ${error.message}`);
  return count ?? 0;
}

/**
 * @param {string} practiceId
 * @param {{ startDate: string, endDate: string, locationId?: string | null }} scope
 */
async function getPeriodCoverage(practiceId, scope) {
  const startDate = scope.startDate;
  const endDate = scope.endDate;
  if (!isYmd(startDate) || !isYmd(endDate)) {
    throw new Error('startDate and endDate (YYYY-MM-DD) are required');
  }

  const locationId = scope.locationId || null;
  const syncRange = await getPracticeSyncRange(practiceId);
  const configuredStart = syncRange.startDate;

  const staleBeforeIso = new Date(Date.now() - STALE_MS).toISOString();
  const syncInProgress = await hasActiveInProgress(
    practiceId,
    [...DATE_WINDOW_RESOURCES],
    staleBeforeIso,
  );

  const invoiceCount = await countInvoicesInPeriod(
    practiceId,
    startDate,
    endDate,
    locationId,
  );
  const ledgerCount = await countLedgerInPeriod(
    practiceId,
    startDate,
    endDate,
    locationId,
  );

  const hasData = invoiceCount > 0 || ledgerCount > 0;
  const flags = derivePeriodCoverageFlags(configuredStart, startDate, hasData);

  return {
    practiceId,
    startDate,
    endDate,
    locationId,
    configuredStart,
    hasData,
    needsSync: flags.needsSync,
    beforeConfiguredStart: flags.beforeConfiguredStart,
    syncInProgress,
    invoiceCount,
    ledgerCount,
  };
}

/**
 * Pure coverage flags for unit tests and API.
 * @param {string} configuredStart YYYY-MM-DD
 * @param {string} startDate YYYY-MM-DD
 * @param {boolean} hasData
 */
function derivePeriodCoverageFlags(configuredStart, startDate, hasData) {
  const beforeConfiguredStart = startDate < configuredStart;
  const needsSync = beforeConfiguredStart || !hasData;
  return { beforeConfiguredStart, needsSync, hasData };
}

module.exports = {
  getPeriodCoverage,
  derivePeriodCoverageFlags,
};
