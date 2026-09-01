/**
 * PE rollup units — practices (organizations) or locations within a multi-site org.
 *
 * When an organization has more than one practice_locations row, PE charts/tables
 * roll up per location instead of a single org row (Dentally multi-site on one token).
 */

const { supabaseAdmin } = require('../../config/supabase');

async function loadUserPracticeIds(userId) {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('organization_id')
    .eq('user_id', userId);

  if (error) throw new Error(`user_roles: ${error.message}`);

  return [
    ...new Set(
      (data ?? [])
        .map((r) => r.organization_id)
        .filter((id) => typeof id === 'string' && id.length > 0),
    ),
  ];
}

async function loadPracticeNames(practiceIds) {
  const map = new Map();
  if (practiceIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .in('id', practiceIds);

  if (error) throw new Error(`organizations: ${error.message}`);

  for (const row of data ?? []) {
    map.set(String(row.id), String(row.name || 'Practice').trim() || 'Practice');
  }
  return map;
}

async function loadLocationsForOrg(organizationId) {
  const { data, error } = await supabaseAdmin
    .from('practice_locations')
    .select('id, location_name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('location_name');

  if (error) throw new Error(`practice_locations: ${error.message}`);

  return (data ?? [])
    .map((row) => ({
      id: String(row.id),
      name: String(row.location_name || 'Site').trim() || 'Site',
    }))
    .filter((row) => row.id.length > 0);
}

function scopePracticeIds(practiceIds, contextPracticeId) {
  if (practiceIds.length === 0) return [contextPracticeId];
  if (practiceIds.includes(contextPracticeId)) return practiceIds;
  return [...practiceIds, contextPracticeId];
}

/**
 * @param {string} userId
 * @param {string} contextPracticeId
 * @returns {Promise<{
 *   rollupMode: 'location' | 'practice',
 *   organizationIds: string[],
 *   units: Array<{
 *     unitId: string,
 *     unitName: string,
 *     unitType: 'location' | 'practice',
 *     organizationId: string,
 *     organizationName: string,
 *     locationId: string | null,
 *   }>,
 * }>}
 */
async function resolvePeRollupUnits(userId, contextPracticeId) {
  const practiceIds = await loadUserPracticeIds(userId);
  const organizationIds = scopePracticeIds(practiceIds, contextPracticeId);
  const orgNames = await loadPracticeNames(organizationIds);

  const units = [];

  for (const orgId of organizationIds) {
    const orgName = orgNames.get(orgId) || 'Practice';
    const locations = await loadLocationsForOrg(orgId);

    if (locations.length > 1) {
      for (const loc of locations) {
        units.push({
          unitId: loc.id,
          unitName: loc.name,
          unitType: 'location',
          organizationId: orgId,
          organizationName: orgName,
          locationId: loc.id,
        });
      }
    } else {
      units.push({
        unitId: orgId,
        unitName: orgName,
        unitType: 'practice',
        organizationId: orgId,
        organizationName: orgName,
        locationId: locations[0]?.id ?? null,
      });
    }
  }

  units.sort((a, b) => a.unitName.localeCompare(b.unitName));

  const rollupMode = units.some((u) => u.unitType === 'location') ? 'location' : 'practice';

  return {
    rollupMode,
    organizationIds,
    units,
  };
}

module.exports = {
  loadUserPracticeIds,
  loadPracticeNames,
  loadLocationsForOrg,
  scopePracticeIds,
  resolvePeRollupUnits,
};
