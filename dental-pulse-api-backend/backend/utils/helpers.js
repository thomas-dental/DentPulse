/**
 * Utility helpers for the sync system.
 */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely parse a value as a BIGINT (number).
 * Returns null for UUIDs (strings containing dashes) and non-numeric values.
 */
function parseBigInt(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.includes('-')) return null;
  const num = typeof value === 'number' ? value : parseInt(value, 10);
  return isNaN(num) ? null : num;
}

/**
 * Map a Dentally site_id to our internal location_id using a pre-built location map.
 * @param {string|number|null} siteId - The Dentally site_id
 * @param {Map<string, string>} locationMap - Map of site_id -> location UUID
 * @param {string} entityAlias - Entity name for logging
 * @returns {string|null} The mapped location UUID or null
 */
function mapSiteIdToLocationId(siteId, locationMap, entityAlias) {
  if (!siteId) return null;
  const siteIdStr = String(siteId);
  const locationId = locationMap.get(siteIdStr);
  if (!locationId && locationMap.size > 0) {
    console.warn(`Site ID ${siteIdStr} not found in location map for ${entityAlias}`);
  }
  return locationId || null;
}

/**
 * Map Dentally uda_band values to valid nhs_band values.
 * DB CHECK constraint only allows: 'Band 1', 'Band 2', 'Band 3', or null.
 */
function mapNhsBand(udaBand) {
  if (!udaBand) return null;
  const val = String(udaBand).trim();

  // Already in correct format
  if (val === 'Band 1' || val === 'Band 2' || val === 'Band 3') return val;

  // Numeric mapping
  const num = parseFloat(val);
  if (!isNaN(num)) {
    if (num >= 2.5) return 'Band 3';
    if (num >= 1.5) return 'Band 2';
    if (num >= 0) return 'Band 1';
  }

  // Unrecognized value — return null to avoid CHECK constraint violation
  return null;
}

/**
 * Truncate a string value to a max length to prevent varchar overflow (Postgres 22001).
 */
function truncate(value, maxLen) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.length > maxLen ? str.substring(0, maxLen) : str;
}

/**
 * Validate a UUID string. Returns the UUID if valid, null otherwise.
 */
function parseUuid(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return str;
  }
  return null;
}

module.exports = { sleep, parseBigInt, mapSiteIdToLocationId, mapNhsBand, truncate, parseUuid };
