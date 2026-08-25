/**
 * Upsert service - handles batch upserts with individual fallback.
 * Also manages category and location map lookups.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { transformRecord } = require('../transformers/dentally');
const { TABLE_MAP, ON_CONFLICT_MAP, ENTITIES_NEEDING_LOCATION_MAP } = require('../../api/dentally/config');

// In-memory caches (per org, refreshed every 5 min) to avoid repeated DB queries across jobs
const treatmentCategoryCache = new Map(); // orgId -> { map, timestamp }
const locationMapCache = new Map();       // orgId -> { map, timestamp }
const categoryMapCache = new Map();       // orgId -> { map, timestamp }
const orgRoutingMapCache = new Map();     // orgId -> { map, allOrgIds, timestamp }
const cancellationReasonCache = new Map(); // orgId -> { map, timestamp }
const acquisitionSourceCache = new Map();  // orgId -> { map, timestamp }
const CACHE_TTL = 5 * 60 * 1000;         // 5 minutes

/**
 * Build a category map: Dentally category ID (external_id) -> our category UUID (id).
 */
async function getCategoryMap(organizationId) {
  const cached = categoryMapCache.get(organizationId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.map;
  }

  const { data: categories, error } = await supabaseAdmin
    .from('treatment_categories')
    .select('id, external_id')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .not('external_id', 'is', null);

  if (error) {
    console.error('[UpsertService] Error fetching category map:', error.message);
    return new Map();
  }

  const map = new Map();
  if (categories) {
    for (const cat of categories) {
      if (cat.external_id && cat.id) {
        map.set(cat.external_id, cat.id);
      }
    }
  }
  categoryMapCache.set(organizationId, { map, timestamp: Date.now() });
  console.log(`[UpsertService] Category map loaded: ${map.size} categories`);
  return map;
}

/**
 * Build a cancellation reason map: Dentally acr_id -> acr_name.
 * Used to denormalize the reason name into the appointments table during sync.
 */
async function getCancellationReasonMap(organizationId) {
  const cached = cancellationReasonCache.get(organizationId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.map;
  }

  const { data: reasons, error } = await supabaseAdmin
    .from('appointment_cancellation_reasons')
    .select('acr_id, acr_name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .not('acr_id', 'is', null);

  if (error) {
    console.error('[UpsertService] Error fetching cancellation reason map:', error.message);
    return new Map();
  }

  const map = new Map();
  if (reasons) {
    for (const r of reasons) {
      if (r.acr_id && r.acr_name) {
        map.set(String(r.acr_id), r.acr_name);
      }
    }
  }
  cancellationReasonCache.set(organizationId, { map, timestamp: Date.now() });
  console.log(`[UpsertService] Cancellation reason map loaded: ${map.size} reasons`);
  return map;
}

/**
 * Build an acquisition source map: Dentally as_id -> as_name.
 * Used to denormalize the source name into patients during sync.
 */
async function getAcquisitionSourceMap(organizationId) {
  const cached = acquisitionSourceCache.get(organizationId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.map;
  }

  const { data: sources, error } = await supabaseAdmin
    .from('acquisition_sources')
    .select('as_id, as_name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .not('as_id', 'is', null);

  if (error) {
    console.error('[UpsertService] Error fetching acquisition source map:', error.message);
    return new Map();
  }

  const map = new Map();
  if (sources) {
    for (const s of sources) {
      if (s.as_id && s.as_name) {
        map.set(String(s.as_id), s.as_name);
      }
    }
  }
  acquisitionSourceCache.set(organizationId, { map, timestamp: Date.now() });
  console.log(`[UpsertService] Acquisition source map loaded: ${map.size} sources`);
  return map;
}

/**
 * Build a location map: Dentally site_id (UUID) -> our location UUID (id).
 * Uses api_record_unique_id which stores the Dentally site UUID.
 *
 * Loads locations across ALL organizations belonging to the same user,
 * because records (invoices, patients, etc.) can reference site_ids
 * from any Dentally site under the same API key.
 */
async function getLocationMap(organizationId) {
  const cached = locationMapCache.get(organizationId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.map;
  }

  // Find the user who owns this organization
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('user_id')
    .eq('id', organizationId)
    .single();

  if (orgError || !org) {
    console.error('[UpsertService] Error fetching org for location map:', orgError?.message);
    return new Map();
  }

  // Get all org IDs for this user
  const { data: userOrgs, error: userOrgsError } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('user_id', org.user_id);

  if (userOrgsError || !userOrgs) {
    console.error('[UpsertService] Error fetching user orgs for location map:', userOrgsError?.message);
    return new Map();
  }

  const orgIds = userOrgs.map(o => o.id);

  // Load locations across ALL user's organizations
  const { data: locations, error } = await supabaseAdmin
    .from('practice_locations')
    .select('id, api_record_unique_id, organization_id')
    .in('organization_id', orgIds)
    .is('deleted_at', null)
    .not('api_record_unique_id', 'is', null);

  if (error) {
    console.error('[UpsertService] Error fetching location map:', error.message);
    return new Map();
  }

  const map = new Map();
  if (locations) {
    // First pass: load all locations (other orgs' locations act as fallback)
    for (const loc of locations) {
      if (loc.id && loc.api_record_unique_id) {
        map.set(String(loc.api_record_unique_id), loc.id);
      }
    }
    // Second pass: override with current org's locations (takes priority over other orgs)
    for (const loc of locations) {
      if (loc.id && loc.api_record_unique_id && loc.organization_id === organizationId) {
        map.set(String(loc.api_record_unique_id), loc.id);
      }
    }
    // Single-location fallback: if this org has exactly one location, store it under
    // '__default__' so transformers can fall back to it when site_id is null.
    // (Dentally doesn't always return practitioner_site_id on every appointment.)
    const orgLocations = locations.filter(l => l.organization_id === organizationId);
    if (orgLocations.length === 1 && orgLocations[0].id) {
      map.set('__default__', orgLocations[0].id);
    }
  }
  locationMapCache.set(organizationId, { map, timestamp: Date.now() });
  console.log(`[UpsertService] Location map loaded: ${map.size} entries (across ${orgIds.length} orgs), default: ${map.get('__default__') || 'none'}`);
  return map;
}

/**
 * Build an org routing map: Dentally site_id (UUID) -> organization_id.
 * Used to route records from a single API response to the correct organization.
 *
 * Reads from practice_locations.api_record_unique_id -> organization_id.
 * This supports both:
 *   - New single-org model (all locations under one org)
 *   - Legacy multi-org model (each org had its own location)
 */
async function getOrgRoutingMap(organizationId) {
  const cached = orgRoutingMapCache.get(organizationId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached;
  }

  // Find the user who owns this organization
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('user_id')
    .eq('id', organizationId)
    .single();

  if (orgError || !org) {
    console.error('[UpsertService] Error fetching org for routing map:', orgError?.message);
    return { map: new Map(), allOrgIds: [organizationId] };
  }

  // Get all orgs for this user
  const { data: userOrgs, error: userOrgsError } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('user_id', org.user_id);

  if (userOrgsError || !userOrgs) {
    console.error('[UpsertService] Error fetching user orgs for routing map:', userOrgsError?.message);
    return { map: new Map(), allOrgIds: [organizationId] };
  }

  const allOrgIds = userOrgs.map(o => o.id);

  // Build routing map from practice_locations (site_id -> org_id)
  const { data: locations, error: locError } = await supabaseAdmin
    .from('practice_locations')
    .select('api_record_unique_id, organization_id')
    .in('organization_id', allOrgIds)
    .is('deleted_at', null)
    .not('api_record_unique_id', 'is', null);

  if (locError) {
    console.error('[UpsertService] Error fetching locations for routing map:', locError.message);
    return { map: new Map(), allOrgIds };
  }

  const map = new Map(); // api_record_unique_id (practice_locations) -> organization_id
  if (locations) {
    for (const loc of locations) {
      if (loc.api_record_unique_id && loc.organization_id) {
        map.set(String(loc.api_record_unique_id), loc.organization_id);
      }
    }
  }

  const result = { map, allOrgIds, timestamp: Date.now() };
  orgRoutingMapCache.set(organizationId, result);
  console.log(`[UpsertService] Org routing map loaded: ${map.size} site->org mappings across ${allOrgIds.length} orgs`);
  return result;
}

/**
 * Upsert an array of raw Dentally records into the appropriate table.
 *
 * @param {string} entityAlias
 * @param {string} organizationId
 * @param {string|null} userId
 * @param {Array} rawRecords - Raw API records
 * @param {object} [maps] - Optional pre-built { categoryMap, locationMap }
 * @param {string|null} [integrationId] - Integration ID for multi-account tracking
 * @param {string[]|null} [syncedSiteIds] - Selected site IDs to sync (null = all sites)
 * @returns {Promise<{ processed: number, failed: number }>}
 */
async function upsertEntityData(entityAlias, organizationId, userId, rawRecords, maps = {}, integrationId = null, syncedSiteIds = null) {
  let processed = 0;
  let failed = 0;

  const tableName = TABLE_MAP[entityAlias];
  const onConflict = ON_CONFLICT_MAP[entityAlias];
  if (!tableName) {
    console.error(`[UpsertService] Unknown table for entity: ${entityAlias}`);
    return { processed, failed };
  }

  // Filter records by selected site IDs (if configured)
  // Entities without site_id (global data) are never filtered
  const NO_SITE_ID_ENTITIES = [
    'treatment_category',
    'treatments',
    'sundries',
    'appointment_cancellation_reasons',
    'acquisition_sources',
    'accounts',
  ];
  const allowedSiteIds = syncedSiteIds && syncedSiteIds.length > 0 ? new Set(syncedSiteIds.map(String)) : null;

  if (allowedSiteIds && !NO_SITE_ID_ENTITIES.includes(entityAlias) && entityAlias !== 'locations') {
    const beforeCount = rawRecords.length;
    rawRecords = rawRecords.filter(record => {
      const siteId = String(record.site_id || '');
      if (!siteId) return true; // Keep records without site_id (resolved later)
      return allowedSiteIds.has(siteId);
    });
    const filtered = beforeCount - rawRecords.length;
    if (filtered > 0) {
      console.log(`[UpsertService] ${entityAlias}: filtered out ${filtered} records (site not in selected sites), keeping ${rawRecords.length}`);
    }
  }

  // For locations entity: only sync selected sites
  if (allowedSiteIds && entityAlias === 'locations') {
    const beforeCount = rawRecords.length;
    rawRecords = rawRecords.filter(record => {
      const siteId = String(record.id || '');
      return allowedSiteIds.has(siteId);
    });
    const filtered = beforeCount - rawRecords.length;
    if (filtered > 0) {
      console.log(`[UpsertService] locations: filtered out ${filtered} sites (not in selected sites), keeping ${rawRecords.length}`);
    }
  }

  if (rawRecords.length === 0) {
    return { processed, failed };
  }

  // Build maps if not provided
  let categoryMap = maps.categoryMap || new Map();
  let locationMap = maps.locationMap || new Map();
  let cancellationReasonMap = maps.cancellationReasonMap || new Map();
  let acquisitionSourceMap = maps.acquisitionSourceMap || new Map();

  if (entityAlias === 'treatments' && categoryMap.size === 0) {
    categoryMap = await getCategoryMap(organizationId);
  }
  if (ENTITIES_NEEDING_LOCATION_MAP.includes(entityAlias) && locationMap.size === 0) {
    locationMap = await getLocationMap(organizationId);
  }
  if ((entityAlias === 'appointments' || entityAlias === 'appointments_current_month') && cancellationReasonMap.size === 0) {
    cancellationReasonMap = await getCancellationReasonMap(organizationId);
  }
  if (entityAlias === 'patients' && acquisitionSourceMap.size === 0) {
    acquisitionSourceMap = await getAcquisitionSourceMap(organizationId);
  }

  // Load org routing map (practice_locations.api_record_unique_id -> organization_id)
  const orgRouting = await getOrgRoutingMap(organizationId);

  if (NO_SITE_ID_ENTITIES.includes(entityAlias)) {
    const ctx = { organizationId, userId, locationMap, categoryMap };
    const transformedRecords = [];
    for (const record of rawRecords) {
      try {
        const transformed = transformRecord(entityAlias, record, ctx);
        if (transformed) {
          if (integrationId) transformed.integration_id = integrationId;
          transformedRecords.push(transformed);
        }
      } catch (err) {
        console.error(`[UpsertService] Transform error for ${entityAlias}:`, err.message);
        failed++;
      }
    }
    if (transformedRecords.length > 0) {
      const result = await batchUpsert(tableName, onConflict, transformedRecords);
      processed += result.processed;
      failed += result.failed;
    }
    return { processed, failed };
  }

  // Special handling for locations: already routes by api_record_unique_id in upsertLocations
  if (entityAlias === 'locations') {
    const ctx = { organizationId, userId, locationMap, categoryMap };
    const transformedRecords = [];
    for (const record of rawRecords) {
      try {
        const transformed = transformRecord(entityAlias, record, ctx);
        if (transformed) {
          if (integrationId) transformed.integration_id = integrationId;
          transformedRecords.push(transformed);
        }
      } catch (err) {
        console.error(`[UpsertService] Transform error for ${entityAlias}:`, err.message);
        failed++;
      }
    }
    if (transformedRecords.length > 0) {
      const result = await upsertLocations(tableName, transformedRecords);
      processed += result.processed;
      failed += result.failed;
    }
    return { processed, failed };
  }

  // Entities WITH site_id — route each record to the correct org
  // Group raw records by target org based on record.site_id
  const recordsByOrg = new Map(); // orgId -> [rawRecords]

  for (const record of rawRecords) {
    const siteId = String(record.site_id || '');
    const targetOrgId = orgRouting.map.get(siteId) || organizationId;
    if (!recordsByOrg.has(targetOrgId)) recordsByOrg.set(targetOrgId, []);
    recordsByOrg.get(targetOrgId).push(record);
  }

  if (recordsByOrg.size > 1) {
    const counts = [...recordsByOrg.entries()].map(([orgId, recs]) => `${orgId.slice(0,8)}:${recs.length}`).join(', ');
    console.log(`[UpsertService] ${entityAlias}: routing records to ${recordsByOrg.size} orgs (${counts})`);
  }

  // Process each org's records
  for (const [targetOrgId, orgRecords] of recordsByOrg) {
    const ctx = {
      organizationId: targetOrgId,
      userId,
      locationMap,
      categoryMap,
      cancellationReasonMap,
      acquisitionSourceMap,
    };

    const transformedRecords = [];
    for (const record of orgRecords) {
      try {
        const transformed = transformRecord(entityAlias, record, ctx);
        if (transformed) {
          if (integrationId) transformed.integration_id = integrationId;
          transformedRecords.push(transformed);
        }
      } catch (err) {
        console.error(`[UpsertService] Transform error for ${entityAlias}:`, err.message);
        failed++;
      }
    }

    if (transformedRecords.length === 0) continue;

    // Special handling for appointments: split by UUID presence
    if (entityAlias === 'appointments' || entityAlias === 'appointments_dna') {
      const result = await upsertAppointments(tableName, onConflict, transformedRecords);
      processed += result.processed;
      failed += result.failed;
      continue;
    }

    // Special handling for invoices: upsert invoices then process line items
    if (entityAlias === 'invoices') {
      const result = await upsertInvoicesWithLineItems(tableName, onConflict, transformedRecords, targetOrgId, integrationId);
      processed += result.processed;
      failed += result.failed;
      continue;
    }

    // Special handling for payments: upsert payments then process explanations
    if (entityAlias === 'payments') {
      const result = await upsertPaymentsWithExplanations(tableName, onConflict, transformedRecords, targetOrgId);
      processed += result.processed;
      failed += result.failed;
      continue;
    }

    // Standard batch upsert
    const result = await batchUpsert(tableName, onConflict, transformedRecords);
    processed += result.processed;
    failed += result.failed;
  }

  return { processed, failed };
}

/**
 * Batch upsert with smaller sub-batch fallback on failure.
 * Uses large batches to minimize Disk IO, falls back to smaller batches (not individual records).
 */
async function batchUpsert(tableName, onConflict, records) {
  let processed = 0;
  let failed = 0;

  // Large batch size to minimize DB round-trips (reduces Disk IO)
  const BATCH_SIZE = 500;
  const chunks = [];
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    chunks.push(records.slice(i, i + BATCH_SIZE));
  }

  for (const chunk of chunks) {
    try {
      const { error } = await supabaseAdmin
        .from(tableName)
        .upsert(chunk, { onConflict });

      if (error) {
        console.error(`[UpsertService] Batch upsert failed for ${tableName}:`, error.message);

        // Fallback: split into smaller sub-batches of 25 (not individual records)
        // This reduces IO from N calls to N/25 calls on failure
        const SUB_BATCH = 25;
        for (let i = 0; i < chunk.length; i += SUB_BATCH) {
          const subChunk = chunk.slice(i, i + SUB_BATCH);
          try {
            const { error: subError } = await supabaseAdmin
              .from(tableName)
              .upsert(subChunk, { onConflict });

            if (subError) {
              console.error(`[UpsertService] Sub-batch upsert failed for ${tableName}: ${subError.message} (${subChunk.length} records)`);
              failed += subChunk.length;
            } else {
              processed += subChunk.length;
            }
          } catch (err) {
            console.error(`[UpsertService] Sub-batch upsert exception:`, err.message);
            failed += subChunk.length;
          }
        }
      } else {
        processed += chunk.length;
      }
    } catch (error) {
      console.error(`[UpsertService] Critical upsert error for ${tableName}:`, error.message);
      failed += chunk.length;
    }
  }

  return { processed, failed };
}

/**
 * Batch insert (no upsert/onConflict needed).
 * Used for tables without unique constraints (e.g. invoice line items).
 */
async function batchInsert(tableName, records) {
  let processed = 0;
  let failed = 0;

  const BATCH_SIZE = 500;
  const chunks = [];
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    chunks.push(records.slice(i, i + BATCH_SIZE));
  }

  for (const chunk of chunks) {
    try {
      const { error } = await supabaseAdmin
        .from(tableName)
        .insert(chunk);

      if (error) {
        console.error(`[UpsertService] Batch insert failed for ${tableName}:`, error.message);

        const SUB_BATCH = 25;
        for (let i = 0; i < chunk.length; i += SUB_BATCH) {
          const subChunk = chunk.slice(i, i + SUB_BATCH);
          try {
            const { error: subError } = await supabaseAdmin
              .from(tableName)
              .insert(subChunk);

            if (subError) {
              console.error(`[UpsertService] Sub-batch insert failed for ${tableName}: ${subError.message} (${subChunk.length} records)`);
              failed += subChunk.length;
            } else {
              processed += subChunk.length;
            }
          } catch (err) {
            console.error(`[UpsertService] Sub-batch insert exception:`, err.message);
            failed += subChunk.length;
          }
        }
      } else {
        processed += chunk.length;
      }
    } catch (error) {
      console.error(`[UpsertService] Critical insert error for ${tableName}:`, error.message);
      failed += chunk.length;
    }
  }

  return { processed, failed };
}

/**
 * Special upsert logic for locations (no external_id column, uses api_record_unique_id as Dentally site ID).
 * Check-then-insert/update approach since there's no unique constraint on api_record_unique_id.
 *
 * Two-step check:
 * 1. First resolve the correct organization via the routing map (location -> org)
 *    Falls back to the job's organization_id if no routing match (e.g. first sync)
 * 2. Then check/upsert the location in practice_locations for that organization
 *
 * The location existence check ignores deleted_at so that soft-deleted locations are
 * updated (and reactivated) rather than duplicated on a fresh/force sync.
 * If multiple rows already exist, only the first is kept and the extras are cleaned up.
 */
async function upsertLocations(tableName, records) {
  let processed = 0;
  let failed = 0;

  // Pre-load org routing map from the first record's organization_id
  let orgRouting = null;
  if (records.length > 0 && records[0].organization_id) {
    orgRouting = await getOrgRoutingMap(records[0].organization_id);
  }

  for (const record of records) {
    try {
      if (!record.api_record_unique_id) {
        console.error('[UpsertService] Location missing api_record_unique_id (Dentally site ID), skipping');
        failed++;
        continue;
      }

      // Resolve the correct organization via org routing map (dentally_site_id -> org_id)
      // Fallback to the job's organization_id (handles first sync when locations are
      // already created by onboarding but not yet in the routing map)
      const targetOrgId = (orgRouting && orgRouting.map.get(String(record.api_record_unique_id)))
        || record.organization_id;

      // Assign the correct organization_id (may differ from the job's org)
      record.organization_id = targetOrgId;

      // Step 2: Check if location already exists for this org + site_id
      // Do NOT filter by deleted_at — find even soft-deleted rows to prevent duplicates
      const { data: existingRows, error: locationCheckError } = await supabaseAdmin
        .from(tableName)
        .select('id')
        .eq('organization_id', targetOrgId)
        .eq('api_record_unique_id', record.api_record_unique_id)
        .order('created_at', { ascending: true })
        .limit(10);

      if (locationCheckError) {
        console.error(`[UpsertService] Location check error:`, locationCheckError.message);
        failed++;
        continue;
      }

      const existingLocation = existingRows && existingRows.length > 0 ? existingRows[0] : null;

      if (existingLocation) {
        // Update the canonical (oldest) row
        const { error: updateError } = await supabaseAdmin
          .from(tableName)
          .update(record)
          .eq('id', existingLocation.id);
        if (updateError) {
          console.error(`[UpsertService] Location update failed:`, updateError.message);
          failed++;
        } else {
          processed++;
        }

        // Self-heal: remove duplicate rows if any (keep only the first/oldest)
        if (existingRows.length > 1) {
          const duplicateIds = existingRows.slice(1).map(r => r.id);
          console.warn(`[UpsertService] Found ${duplicateIds.length} duplicate location(s) for api_record_unique_id=${record.api_record_unique_id}, removing extras`);
          await supabaseAdmin
            .from(tableName)
            .delete()
            .in('id', duplicateIds);
        }
      } else {
        // Insert new location
        const { error: insertError } = await supabaseAdmin
          .from(tableName)
          .insert(record);
        if (insertError) {
          console.error(`[UpsertService] Location insert failed:`, insertError.message);
          failed++;
        } else {
          processed++;
        }
      }
    } catch (err) {
      console.error(`[UpsertService] Location upsert exception:`, err.message);
      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Special upsert logic for appointments (handles records with and without UUID).
 */
async function upsertAppointments(tableName, onConflict, records) {
  let processed = 0;
  let failed = 0;

  const withUuid = records.filter(r => r.apmt_unique_id != null);
  const withoutUuid = records.filter(r => r.apmt_unique_id == null);

  // Batch upsert those with UUID
  if (withUuid.length > 0) {
    const result = await batchUpsert(tableName, onConflict, withUuid);
    processed += result.processed;
    failed += result.failed;
  }

  // Handle those without UUID individually (check-then-insert/update)
  for (const record of withoutUuid) {
    try {
      if (!record.apmt_id && record.apmt_id !== 0) {
        failed++;
        continue;
      }

      const { data: existing, error: checkError } = await supabaseAdmin
        .from(tableName)
        .select('id')
        .eq('organization_id', record.organization_id)
        .eq('apmt_id', record.apmt_id)
        .is('apmt_unique_id', null)
        .limit(1)
        .maybeSingle();

      if (checkError) {
        failed++;
        continue;
      }

      if (existing) {
        const { error: updateError } = await supabaseAdmin
          .from(tableName)
          .update(record)
          .eq('id', existing.id);
        if (updateError) failed++;
        else processed++;
      } else {
        const { error: insertError } = await supabaseAdmin
          .from(tableName)
          .insert(record);
        if (insertError) failed++;
        else processed++;
      }
    } catch (err) {
      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Special upsert logic for invoices: upsert invoices, then process line items.
 */
async function upsertInvoicesWithLineItems(tableName, onConflict, records, organizationId, integrationId = null) {
  let processed = 0;
  let failed = 0;

  // 1. Extract _invoice_items from records before DB upsert
  const savedInvoiceItems = records.map(record => ({
    platform_invoice_id: record.platform_invoice_id,
    items: record._invoice_items || [],
  }));

  // Diagnostic: how many invoices resolved a UUID for Dentally deep links
  // (sourced from line items by the transformer). If this is persistently 0,
  // the invoice-UUID field assumption is wrong — surface it rather than fail
  // silently. Safe to remove once confirmed populated.
  const withUuid = records.filter(r => r.invoice_uuid).length;
  console.log(`[UpsertService] Invoices: ${withUuid}/${records.length} resolved invoice_uuid (deep link)`);

  // Remove _invoice_items from all records
  for (const record of records) {
    delete record._invoice_items;
  }

  // 2. Batch upsert invoices
  const invoiceResult = await batchUpsert(tableName, onConflict, records);
  processed = invoiceResult.processed;
  failed = invoiceResult.failed;

  // 3. Process invoice line items
  const invoicesWithItems = savedInvoiceItems.filter(inv => inv.items.length > 0);
  if (invoicesWithItems.length === 0) {
    return { processed, failed };
  }

  console.log(`[UpsertService] Processing line items for ${invoicesWithItems.length} invoices...`);

  // Fetch invoice UUIDs from DB (always needed per page)
  const platformInvoiceIds = invoicesWithItems.map(inv => inv.platform_invoice_id);

  // Check if treatment category map is cached (saves 1 DB call per page)
  const cached = treatmentCategoryCache.get(organizationId);
  const hasFreshCache = cached && (Date.now() - cached.timestamp) < CACHE_TTL;

  // Only fetch treatment categories if not cached
  const fetchPromises = [
    supabaseAdmin
      .from('platform_integration_invoices')
      .select('id, platform_invoice_id')
      .eq('organization_id', organizationId)
      .eq('platform_type', 'dentally')
      .in('platform_invoice_id', platformInvoiceIds),
  ];

  if (!hasFreshCache) {
    fetchPromises.push(
      supabaseAdmin
        .from('treatments')
        .select('external_id, treatment_categories!inner(name)')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .not('external_id', 'is', null)
    );
  }

  const results = await Promise.all(fetchPromises);

  const { data: invoiceRecords, error: invoiceFetchError } = results[0];

  if (invoiceFetchError || !invoiceRecords || invoiceRecords.length === 0) {
    console.error('[UpsertService] Failed to fetch invoice UUIDs for line items:', invoiceFetchError?.message || 'No records found');
    return { processed, failed };
  }

  const invoiceIdMap = new Map();
  for (const inv of invoiceRecords) {
    invoiceIdMap.set(inv.platform_invoice_id, inv.id);
  }

  // Build or reuse treatment category map
  let treatmentCategoryMap;
  if (hasFreshCache) {
    treatmentCategoryMap = cached.map;
  } else {
    treatmentCategoryMap = new Map();
    const { data: treatments, error: treatmentsError } = results[1];
    if (!treatmentsError && treatments) {
      for (const t of treatments) {
        if (t.external_id && t.treatment_categories && t.treatment_categories.name) {
          treatmentCategoryMap.set(Number(t.external_id), t.treatment_categories.name);
        }
      }
    }
    treatmentCategoryCache.set(organizationId, { map: treatmentCategoryMap, timestamp: Date.now() });
  }

  // Transform all line items
  const allLineItems = [];

  for (const savedInvoice of invoicesWithItems) {
    const invoiceUuid = invoiceIdMap.get(savedInvoice.platform_invoice_id);
    if (!invoiceUuid) {
      console.error(`[UpsertService] No DB UUID for invoice ${savedInvoice.platform_invoice_id}, skipping line items`);
      continue;
    }

    const invoiceItems = savedInvoice.items;

    // Track duplicate IDs
    const seenIds = new Map();
    for (const item of invoiceItems) {
      if (item.id) {
        const idStr = String(item.id);
        seenIds.set(idStr, (seenIds.get(idStr) || 0) + 1);
      }
    }

    for (let idx = 0; idx < invoiceItems.length; idx++) {
      const item = invoiceItems[idx];

      // Generate unique platform_line_id
      let platformLineId;
      if (item.id) {
        const idStr = String(item.id);
        if (seenIds.get(idStr) > 1) {
          platformLineId = `${idStr}-${idx}`;
        } else {
          platformLineId = idStr;
        }
      } else {
        platformLineId = `${savedInvoice.platform_invoice_id}-${idx}`;
      }

      // Get treatment category
      let treatmentCategory = null;
      let treatmentIdNum = null;
      if (item.treatment_id) {
        treatmentIdNum = typeof item.treatment_id === 'number'
          ? item.treatment_id
          : parseInt(String(item.treatment_id), 10);
        if (!isNaN(treatmentIdNum)) {
          treatmentCategory = treatmentCategoryMap.get(treatmentIdNum) || null;
        } else {
          treatmentIdNum = null;
        }
      }

      allLineItems.push({
        organization_id: organizationId,
        ...(integrationId ? { integration_id: integrationId } : {}),
        platform_line_id: platformLineId,
        invoice_id: invoiceUuid,
        // The invoiced-item UUID (Dentally line item `id`). This is the only
        // invoice-related UUID the API returns (invoice.id and item.invoice_id
        // are numeric), and it's what the Dentally web app uses to open the
        // invoice: /patients/{uuid}/account/{uuid}/invoices/{this}.
        dentally_invoice_id: item.id != null ? String(item.id) : null,
        treatment_id: treatmentIdNum,
        treatment_category: treatmentCategory,
        practitioner_id: item.practitioner_id ? String(item.practitioner_id) : null,
        sundry_id: item.sundry_id ? String(item.sundry_id) : null,
        treatment_plan_id: item.treatment_plan_id ? String(item.treatment_plan_id) : null,
        treatment_plan_item_id: item.treatment_plan_item_id ? String(item.treatment_plan_item_id) : null,
        item_name: item.name || null,
        description: item.name || item.description || null,
        quantity: item.quantity || 0,
        line_amount: item.total_price ? parseFloat(item.total_price) : 0,
        gross: item.total_price ? parseFloat(item.total_price) : 0,
        discount: 0,
        net: item.total_price ? parseFloat(item.total_price) : 0,
        tax: 0,
        api_record_created_at: item.created_at || null,
        api_record_updated_at: item.updated_at || null,
      });
    }
  }

  if (allLineItems.length > 0) {
    console.log(`[UpsertService] Inserting ${allLineItems.length} invoice line items...`);

    // Delete existing line items for these invoices first (no unique constraint on table)
    const invoiceUuids = [...new Set(allLineItems.map(li => li.invoice_id))];
    const { error: deleteError } = await supabaseAdmin
      .from('platform_integration_invoice_line_items')
      .delete()
      .eq('organization_id', organizationId)
      .in('invoice_id', invoiceUuids);

    if (deleteError) {
      console.error(`[UpsertService] Failed to delete old line items:`, deleteError.message);
    }

    // Insert fresh line items (no onConflict needed)
    const lineItemResult = await batchInsert(
      'platform_integration_invoice_line_items',
      allLineItems
    );
    console.log(`[UpsertService] Line items: ${lineItemResult.processed} inserted, ${lineItemResult.failed} failed`);
  }

  return { processed, failed };
}

/**
 * Upsert payments, then process their nested explanations as child records.
 * Pattern mirrors upsertInvoicesWithLineItems: upsert parents, then
 * delete-and-reinsert children keyed by parent UUID.
 */
async function upsertPaymentsWithExplanations(tableName, onConflict, records, organizationId) {
  let processed = 0;
  let failed = 0;

  // 1. Extract _explanations before DB upsert
  const savedExplanations = records.map(record => ({
    dp_id: record.dp_id,
    explanations: record._explanations || [],
  }));
  for (const record of records) {
    delete record._explanations;
  }

  // 2. Batch upsert payments
  const paymentResult = await batchUpsert(tableName, onConflict, records);
  processed = paymentResult.processed;
  failed = paymentResult.failed;

  // 3. Process explanations
  const paymentsWithExplanations = savedExplanations.filter(p => p.explanations.length > 0);
  if (paymentsWithExplanations.length === 0) {
    return { processed, failed };
  }

  console.log(`[UpsertService] Processing explanations for ${paymentsWithExplanations.length} payments...`);

  // Fetch payment UUIDs from DB
  const dpIds = paymentsWithExplanations.map(p => p.dp_id);
  const { data: paymentRecords, error: paymentFetchError } = await supabaseAdmin
    .from('dentally_payments')
    .select('id, dp_id')
    .eq('organization_id', organizationId)
    .in('dp_id', dpIds);

  if (paymentFetchError || !paymentRecords || paymentRecords.length === 0) {
    console.error('[UpsertService] Failed to fetch payment UUIDs for explanations:', paymentFetchError?.message || 'No records found');
    return { processed, failed };
  }

  const paymentIdMap = new Map();
  for (const p of paymentRecords) {
    paymentIdMap.set(Number(p.dp_id), p.id);
  }

  // Build explanation records
  const allExplanations = [];
  for (const saved of paymentsWithExplanations) {
    const paymentUuid = paymentIdMap.get(Number(saved.dp_id));
    if (!paymentUuid) continue;

    for (const exp of saved.explanations) {
      allExplanations.push({
        organization_id: organizationId,
        payment_id: paymentUuid,
        dpe_id: exp.id ? Number(exp.id) : null,
        dpe_amount: exp.amount ? parseFloat(exp.amount) : null,
        dpe_comments: exp.comments || null,
        dpe_invoice_id: exp.invoice_id ? Number(exp.invoice_id) : null,
        dpe_invoice_reference: exp.invoice_reference ? String(exp.invoice_reference) : null,
        dpe_payment_id: exp.payment_id ? Number(exp.payment_id) : null,
        dpe_payment_reference: exp.payment_reference ? String(exp.payment_reference) : null,
        dpe_user_id: exp.user_id ? Number(exp.user_id) : null,
      });
    }
  }

  if (allExplanations.length > 0) {
    console.log(`[UpsertService] Inserting ${allExplanations.length} payment explanations...`);

    // Delete existing explanations for these payments first
    const paymentUuids = [...new Set(allExplanations.map(e => e.payment_id))];
    const { error: deleteError } = await supabaseAdmin
      .from('dentally_payment_explanations')
      .delete()
      .eq('organization_id', organizationId)
      .in('payment_id', paymentUuids);

    if (deleteError) {
      console.error('[UpsertService] Failed to delete old explanations:', deleteError.message);
    }

    const expResult = await batchInsert('dentally_payment_explanations', allExplanations);
    console.log(`[UpsertService] Explanations: ${expResult.processed} inserted, ${expResult.failed} failed`);
  }

  return { processed, failed };
}

/**
 * Invalidate cached maps for an org (call after locations/categories are synced).
 */
function invalidateMapCaches(organizationId) {
  locationMapCache.delete(organizationId);
  categoryMapCache.delete(organizationId);
  treatmentCategoryCache.delete(organizationId);
  orgRoutingMapCache.delete(organizationId);
  cancellationReasonCache.delete(organizationId);
  acquisitionSourceCache.delete(organizationId);
}

module.exports = {
  upsertEntityData,
  upsertInvoicesWithLineItems,
  upsertPaymentsWithExplanations,
  getCategoryMap,
  getLocationMap,
  getCancellationReasonMap,
  getAcquisitionSourceMap,
  invalidateMapCaches,
};
