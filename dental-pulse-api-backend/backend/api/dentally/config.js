/**
 * Configuration for all syncable Dentally entities.
 * Priority order determines sync sequence (lower = synced first).
 */

const ENTITIES = [
  {
    alias: 'locations',
    endpoint: '/v1/sites',
    table: 'practice_locations',
    onConflict: null, // custom check-then-insert/update logic (no external_id column)
    responseKey: 'sites',
    priority: 1,
    dateFilter: null,
  },
  {
    alias: 'treatment_category',
    endpoint: '/v1/treatment_categories',
    table: 'treatment_categories',
    onConflict: 'organization_id,external_id',
    responseKey: 'treatment_categories',
    priority: 2,
    dateFilter: null,
  },
  {
    alias: 'payment_plans',
    endpoint: '/v1/payment_plans',
    table: 'payment_plans',
    onConflict: 'organization_id,pp_id',
    responseKey: 'payment_plans',
    priority: 3,
    dateFilter: null,
  },
  {
    alias: 'appointment_cancellation_reasons',
    endpoint: '/v1/appointment_cancellation_reasons',
    table: 'appointment_cancellation_reasons',
    onConflict: 'organization_id,acr_id',
    responseKey: 'appointment_cancellation_reasons',
    priority: 4,
    dateFilter: null,
  },
  {
    alias: 'sundries',
    endpoint: '/v1/sundries',
    table: 'sundries',
    onConflict: 'organization_id,external_id',
    responseKey: 'sundries',
    priority: 5,
    dateFilter: null,
  },
  {
    alias: 'treatments',
    endpoint: '/v1/treatments',
    table: 'treatments',
    onConflict: 'organization_id,external_id',
    responseKey: 'treatments',
    priority: 5,
    dateFilter: null,
    // Stable sort so paginating across pages doesn't repeat or skip rows.
    // Without sort_by, Dentally returned ~30 rows fewer than meta.total
    // because pagination order shifted between page fetches. created_at is
    // the same value the other Dentally endpoints (patients, treatment_plans)
    // already use successfully.
    sortBy: 'created_at',
  },
  {
    alias: 'practitioners',
    endpoint: '/v1/practitioners',
    table: 'providers',
    onConflict: 'organization_id,external_id',
    responseKey: 'practitioners',
    priority: 5,
    dateFilter: null,
  },
  {
    alias: 'patients',
    endpoint: '/v1/patients',
    table: 'patients',
    onConflict: 'organization_id,pt_unique_id',
    responseKey: 'patients',
    priority: 6,
    // updated_after (was created_after) so incremental syncs re-fetch existing
    // patients whose payment-plan membership, recall dates or active flag
    // changed in Dentally — created_after only ever saw brand-new patients,
    // leaving those fields permanently stale after the initial backfill.
    // Initial syncs are unaffected (jobQueue passes no date filter while
    // last_synced_at is null). The API has no updated_before, so this stays a
    // single-date entity; sort_by stays created_at (stable pagination order).
    dateFilter: 'updated_after',
    dateFilterEnd: null,
    sortBy: 'created_at',
  },
  {
    // Billing accounts (account holders / payers). Referenced by patients
    // (pt_account_id), invoices (account_id), and payments (dp_account_id).
    // Synced as a non-date entity so the full set is always present — the API
    // doesn't expose useful date filters on this endpoint and the volume is
    // bounded by the patient count.
    alias: 'accounts',
    endpoint: '/v1/accounts',
    table: 'dentally_patients_accounts',
    onConflict: 'organization_id,da_id',
    responseKey: 'accounts',
    priority: 6,
    dateFilter: null,
    // Only sync negative-balance (in-debit) accounts. Dentally's `state` filter
    // accepts 'credit' | 'debit'; 'debit' = the negative-balance accounts we
    // want. This also slashes volume (each account costs one /v1/accounts/{id}
    // detail call), easing the rate-limit pressure that was failing this entity.
    extraParams: { state: 'debit' },
  },
  {
    alias: 'treatment_plans',
    endpoint: '/v1/treatment_plans',
    table: 'treatment_plans',
    onConflict: 'organization_id,tp_id',
    responseKey: 'treatment_plans',
    priority: 7,
    dateFilter: 'created_after',
    dateFilterEnd: 'created_before',
    sortBy: 'created_at',
    // No completed filter: fetch ALL treatment plans so TPIs on incomplete plans are captured.
    // Frontend filters by tpi_completed=true at query time.
  },
  {
    alias: 'treatment_plan_items',
    endpoint: '/v1/treatment_plan_items',
    table: 'treatment_plan_items',
    onConflict: 'organization_id,tpi_id',
    responseKey: 'treatment_plan_items',
    priority: 8,
    dateFilter: 'updated_after',
    dateFilterEnd: 'updated_before',
    sortBy: 'updated_at',
  },
  {
    alias: 'treatment_appointments',
    endpoint: '/v1/treatment_appointments',
    table: 'treatment_appointments',
    onConflict: 'organization_id,ta_id',
    responseKey: 'treatment_appointments',
    priority: 9,
    dateFilter: 'updated_after',
    dateFilterEnd: 'updated_before',
    sortBy: 'updated_at',
  },
  {
    alias: 'appointments',
    endpoint: '/v1/appointments',
    table: 'appointments',
    onConflict: 'organization_id,apmt_unique_id',
    responseKey: 'appointments',
    priority: 10,
    // Use updated_after so incremental syncs pick up state changes
    // (e.g. Completed → Cancelled) on existing appointments.
    // No state filter — sync all states so cancellations/DNA are reflected.
    // cancelled: true is required by Dentally to include Cancelled + DNA appointments.
    dateFilter: 'updated_after',
    dateFilterEnd: 'updated_before',
    sortBy: 'updated_at',
    extraParams: { cancelled: true },
  },
  {
    alias: 'appointments_current_month',
    endpoint: '/v1/appointments',
    table: 'appointments',
    onConflict: 'organization_id,apmt_unique_id',
    responseKey: 'appointments',
    priority: 10,
    // Uses start_time filter (after/before) instead of updated_after so that
    // Pending appointments booked months ago for the current month are always
    // re-fetched, regardless of when they were last updated in Dentally.
    dateFilter: 'after',
    dateFilterEnd: 'before',
    sortBy: 'start_time',
    extraParams: { cancelled: true },
  },
  {
    alias: 'invoices',
    endpoint: '/v1/invoices',
    table: 'platform_integration_invoices',
    onConflict: 'organization_id,platform_type,platform_invoice_id',
    responseKey: 'invoices',
    priority: 11,
    dateFilter: 'dated_on_after',
    dateFilterEnd: 'dated_on_before',
    endDateInclusive: true,
    sortBy: 'dated_on',
    // No paid filter: store all invoices (paid + unpaid). Frontends filter by is_paid=true at query time.
  },
  {
    alias: 'payments',
    endpoint: '/v1/payments',
    table: 'dentally_payments',
    onConflict: 'organization_id,dp_id',
    responseKey: 'payments',
    priority: 12,
    dateFilter: 'dated_after',
    dateFilterEnd: 'dated_before',
    sortBy: 'dated_on',
  },
  {
    alias: 'nhs_claims',
    endpoint: '/v1/nhs_claims',
    // Dedupe on the NHS reference number (nc_sequence_number). The API `id` is
    // a UUID — parseBigInt(record.id) was always NULL, so the old
    // (organization_id, nc_id) key never matched and every sync re-inserted
    // every claim. nc_sequence_number is populated on every row and unique per
    // claim. (matching unique constraint: nhs_claims_org_sequence_key)
    table: 'nhs_claims',
    onConflict: 'organization_id,nc_sequence_number',
    responseKey: 'nhs_claims',
    priority: 13,
    dateFilter: 'updated_after',
    dateFilterEnd: 'updated_before',
    sortBy: 'updated_at',
  },
];

/** Lookup helpers */
const ENTITY_BY_ALIAS = {};
const ENDPOINT_MAP = {};
const TABLE_MAP = {};
const ON_CONFLICT_MAP = {};
const RESPONSE_KEY_MAP = {};

for (const e of ENTITIES) {
  ENTITY_BY_ALIAS[e.alias] = e;
  ENDPOINT_MAP[e.alias] = e.endpoint;
  TABLE_MAP[e.alias] = e.table;
  ON_CONFLICT_MAP[e.alias] = e.onConflict;
  RESPONSE_KEY_MAP[e.alias] = e.responseKey;
}

/** Entities that need location map lookups */
const ENTITIES_NEEDING_LOCATION_MAP = [
  'appointments',
  'appointments_current_month',
  'payment_plans',
  'patients',
  'practitioners',
  'treatment_plans',
  'treatment_plan_items',
  'treatment_appointments',
  'payments',
  'invoices',
  'nhs_claims',
  'sundries'
];

/** Non-date entities (fetched all at once) */
const NON_DATE_ENTITIES = ENTITIES.filter(e => !e.dateFilter).map(e => e.alias);

/** Date-filterable entities (chunked by month) */
const DATE_ENTITIES = ENTITIES.filter(e => e.dateFilter).map(e => e.alias);

module.exports = {
  ENTITIES,
  ENTITY_BY_ALIAS,
  ENDPOINT_MAP,
  TABLE_MAP,
  ON_CONFLICT_MAP,
  RESPONSE_KEY_MAP,
  ENTITIES_NEEDING_LOCATION_MAP,
  NON_DATE_ENTITIES,
  DATE_ENTITIES,
};
