/**
 * Location scoping for PE metrics — filter org-level facts by patient home location.
 */

const { supabaseAdmin } = require('../../config/supabase');

const PAGE_SIZE = 1000;

async function loadPatientUuidsForLocation(organizationId, locationId) {
  const ids = [];
  let offset = 0;

  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('location_id', locationId)
      .is('deleted_at', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`patients location scope: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      if (row.id) ids.push(String(row.id));
    }
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return ids;
}

async function loadPtIdsForLocation(organizationId, locationId) {
  const ids = [];
  let offset = 0;

  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select('pt_id')
      .eq('organization_id', organizationId)
      .eq('location_id', locationId)
      .is('deleted_at', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`patients pt_id location scope: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      if (row.pt_id != null) ids.push(Number(row.pt_id));
    }
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return ids;
}

module.exports = {
  loadPatientUuidsForLocation,
  loadPtIdsForLocation,
};
