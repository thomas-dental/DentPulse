/**
 * Registry of PE sync resource_type → chunk function.
 * Remaining Day 5 (membership) registers here when added.
 */

const { SCHEDULED_RESOURCE_TYPES } = require('./cursorStore');
const { syncAcquisitionSources } = require('./syncAcquisitionSources');
const { syncPractitioners } = require('./syncPractitioners');
const { syncPatients } = require('./syncPatients');
const { syncAccounts } = require('./syncAccounts');
const { syncRecalls } = require('./syncRecalls');
const { syncAppointments } = require('./syncAppointments');
const { syncTreatmentAppointments } = require('./syncTreatmentAppointments');
const { syncTreatmentPlans } = require('./syncTreatmentPlans');
const { syncTreatmentItems } = require('./syncTreatmentItems');
const { syncInvoices } = require('./syncInvoices');
const { syncPayments } = require('./syncPayments');

const SYNC_BY_RESOURCE = {
  acquisition_sources: syncAcquisitionSources,
  practitioners: syncPractitioners,
  patients: syncPatients,
  accounts: syncAccounts,
  recalls: syncRecalls,
  appointments: syncAppointments,
  treatment_appointments: syncTreatmentAppointments,
  treatment_plans: syncTreatmentPlans,
  treatment_items: syncTreatmentItems,
  invoices: syncInvoices,
  payments: syncPayments,
};

function getSyncFn(resourceType) {
  return SYNC_BY_RESOURCE[resourceType] || null;
}

function listRegisteredResourceTypes() {
  return [...SCHEDULED_RESOURCE_TYPES];
}

module.exports = {
  SYNC_BY_RESOURCE,
  getSyncFn,
  listRegisteredResourceTypes,
};
