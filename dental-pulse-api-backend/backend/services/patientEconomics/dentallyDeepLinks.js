/**
 * Dentally web app deep-link URLs (mirrors dental-pulse-dev/src/lib/dentallyDeepLinks.ts).
 */

const DENTALLY_APP_ORIGIN = 'https://app.dentally.co';

function isUuid(value) {
  if (!value || typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function buildDentallyPatientUrl(dentallyPatientUuid) {
  if (!isUuid(dentallyPatientUuid)) return null;
  return `${DENTALLY_APP_ORIGIN}/patients/${dentallyPatientUuid.trim()}`;
}

function buildDentallyAccountPaymentsUrl(dentallyPatientUuid, accountUuid) {
  const patientUrl = buildDentallyPatientUrl(dentallyPatientUuid);
  if (!patientUrl || !isUuid(accountUuid)) return null;
  const filterAccounts = encodeURIComponent(`["${accountUuid.trim()}"]`);
  return `${patientUrl}/account/${accountUuid.trim()}?activeTab=payments&filterAccounts=${filterAccounts}`;
}

function buildDentallyInvoiceUrl({ dentallyPatientUuid, accountUuid, invoiceUuid }) {
  if (!isUuid(dentallyPatientUuid) || !isUuid(accountUuid)) return null;
  if (isUuid(invoiceUuid)) {
    return `${DENTALLY_APP_ORIGIN}/patients/${dentallyPatientUuid.trim()}/account/${accountUuid.trim()}/invoices/${invoiceUuid.trim()}`;
  }
  return buildDentallyAccountPaymentsUrl(dentallyPatientUuid, accountUuid);
}

function resolveAccountUuidFromDaId(daId, accountUuidByDaId) {
  if (daId == null || daId === '') return null;
  const n = Number(daId);
  if (!Number.isFinite(n) || n <= 0) return null;
  const uuid = accountUuidByDaId.get(n);
  return uuid && isUuid(uuid) ? uuid : null;
}

module.exports = {
  buildDentallyPatientUrl,
  buildDentallyInvoiceUrl,
  resolveAccountUuidFromDaId,
};
