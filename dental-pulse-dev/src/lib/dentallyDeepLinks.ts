/**
 * Deep-link URLs into Dentally's web app (app.dentally.co).
 * Patterns match ProviderActivity, Membership insights, and NHSClaims.
 */

export const DENTALLY_APP_ORIGIN = 'https://app.dentally.co';

function isUuid(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function buildDentallyPatientUrl(dentallyPatientUuid: string | null | undefined): string | null {
  if (!isUuid(dentallyPatientUuid)) return null;
  return `${DENTALLY_APP_ORIGIN}/patients/${dentallyPatientUuid.trim()}`;
}

export function buildDentallyPatientAppointmentsUrl(
  dentallyPatientUuid: string | null | undefined,
): string | null {
  if (!isUuid(dentallyPatientUuid)) return null;
  return `${DENTALLY_APP_ORIGIN}/patients/${dentallyPatientUuid.trim()}/appointments`;
}

export function buildDentallyAccountPaymentsUrl(
  dentallyPatientUuid: string | null | undefined,
  accountUuid: string | null | undefined,
): string | null {
  const patientUrl = buildDentallyPatientUrl(dentallyPatientUuid);
  if (!patientUrl || !isUuid(accountUuid)) return null;
  const filterAccounts = encodeURIComponent(`["${accountUuid.trim()}"]`);
  return `${patientUrl}/account/${accountUuid.trim()}?activeTab=payments&filterAccounts=${filterAccounts}`;
}

export type DentallyInvoiceLinkInput = {
  dentallyPatientUuid?: string | null;
  accountUuid?: string | null;
  invoiceUuid?: string | null;
};

/**
 * Prefer direct invoice URL when invoice_uuid is synced; otherwise account payments tab.
 */
export function buildDentallyInvoiceUrl(input: DentallyInvoiceLinkInput): string | null {
  const patientUuid = input.dentallyPatientUuid;
  const accountUuid = input.accountUuid;
  const invoiceUuid = input.invoiceUuid;

  if (!isUuid(patientUuid) || !isUuid(accountUuid)) return null;

  if (isUuid(invoiceUuid)) {
    return `${DENTALLY_APP_ORIGIN}/patients/${patientUuid!.trim()}/account/${accountUuid!.trim()}/invoices/${invoiceUuid!.trim()}`;
  }

  return buildDentallyAccountPaymentsUrl(patientUuid, accountUuid);
}

export function resolveAccountUuidFromDaId(
  daId: number | string | null | undefined,
  accountUuidByDaId: Map<number, string>,
): string | null {
  if (daId == null || daId === '') return null;
  const n = Number(daId);
  if (!Number.isFinite(n) || n <= 0) return null;
  const uuid = accountUuidByDaId.get(n);
  return uuid && isUuid(uuid) ? uuid : null;
}
