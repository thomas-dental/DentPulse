/**
 * Iplicit sync processor — processes a single sync job (all records in one call).
 *
 * Unlike Dentally (paginated), Iplicit entity endpoints return all data in a
 * single response, so there is no page loop — just fetch → transform → upsert.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { getOrRefreshSession, fetchEnquiry, fetchLegalEntities, fetchRestApiPaged, fetchRestApiById } = require('../../api/iplicit/client');
const { transformRecord } = require('../../services/transformers/iplicit');
const { TABLE_MAP, ON_CONFLICT_MAP, ENQUIRY_MAP, ENTITY_BY_ALIAS } = require('../../api/iplicit/config');
const {
  ensureFinanceDataSource,
  syncAccountsFromIplicitChartTable,
  syncJournalsFromIplicitReportTables,
} = require('../../services/normalizers/iplicitToCanonical');
const logger = require('../../services/sync/logger');

const BATCH_SIZE = 500;
const SUB_BATCH_SIZE = 25;

/**
 * Batch upsert with sub-batch fallback on error.
 */
async function batchUpsert(tableName, onConflict, records) {
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await supabaseAdmin.from(tableName).upsert(chunk, { onConflict });

      if (error) {
        console.error(`[IplicitEngine] Batch upsert failed for ${tableName}: ${error.message} — falling back to sub-batches`);

        for (let j = 0; j < chunk.length; j += SUB_BATCH_SIZE) {
          const sub = chunk.slice(j, j + SUB_BATCH_SIZE);
          try {
            const { error: subErr } = await supabaseAdmin.from(tableName).upsert(sub, { onConflict });
            if (subErr) {
              console.error(`[IplicitEngine] Sub-batch upsert failed: ${subErr.message}`);
              failed += sub.length;
            } else {
              processed += sub.length;
            }
          } catch (e) {
            console.error(`[IplicitEngine] Sub-batch exception:`, e.message);
            failed += sub.length;
          }
        }
      } else {
        processed += chunk.length;
      }
    } catch (err) {
      console.error(`[IplicitEngine] Batch exception for ${tableName}:`, err.message);
      failed += chunk.length;
    }
  }

  return { processed, failed };
}

/**
 * Fetch raw records from Iplicit for the given entity.
 * Supports three fetch strategies:
 *   - 'legal_entities'   — GET /api/LegalEntity (single call, no pagination)
 *   - 'rest_api_paged'   — GET /api/<endpoint> with skip/top pagination
 *   - default (Enquiry)  — POST /api/Enquiry/run/{enquiryId}/list?top=N
 *
 * @param {string} entityAlias
 * @param {string} domain
 * @param {string} sessionToken
 * @param {object} bodyParams  - e.g. { PeriodDateFrom, PeriodDateTo, Currency } (Enquiry only)
 * @param {number} topLimit    - page size (REST paged) or max records (Enquiry)
 * @param {string|null} dateFrom  - YYYY-MM-DD (REST paged, optional)
 * @param {string|null} dateTo    - YYYY-MM-DD (REST paged, optional)
 */
async function fetchEntityRecords(entityAlias, domain, sessionToken, bodyParams = {}, topLimit = 1000, dateFrom = null, dateTo = null) {
  const entityConfig = ENTITY_BY_ALIAS[entityAlias] || {};

  // Legal entities use GET /api/LegalEntity — not the Enquiry API
  if (entityConfig.fetchType === 'legal_entities') {
    return fetchLegalEntities(domain, sessionToken);
  }

  // REST API with skip/top pagination (e.g. /api/Payment, /api/Receipt)
  if (entityConfig.fetchType === 'rest_api_paged') {
    const endpoint = entityConfig.restEndpoint;
    if (!endpoint) {
      throw new Error(`No restEndpoint configured for ${entityAlias}`);
    }
    const pageSize = topLimit || 100;
    const allRecords = [];
    let skip = 0;

    while (true) {
      const page = await fetchRestApiPaged(domain, sessionToken, endpoint, skip, pageSize, dateFrom, dateTo);
      if (!page || page.length === 0) break;
      allRecords.push(...page);
      if (page.length < pageSize) break;  // last page
      skip += pageSize;
    }

    console.log(`[IplicitEngine] ${entityAlias}: fetched ${allRecords.length} records via REST (${endpoint})`);
    return allRecords;
  }

  // Default: Enquiry API (POST)
  const enquiryId = ENQUIRY_MAP[entityAlias];
  if (!enquiryId) {
    throw new Error(`No Enquiry ID configured for Iplicit entity: ${entityAlias}`);
  }
  return fetchEnquiry(domain, sessionToken, enquiryId, bodyParams, topLimit);
}

/**
 * Fetch allocations by calling the detail endpoint for each parent record.
 * GET /api/Receipt/{id} or GET /api/Payment/{id} → response.allocations[]
 * Each allocation row is returned with _parentId embedded for the transformer.
 *
 * @param {object} entityConfig
 * @param {object} connection   - platform_integrations row
 * @param {string} sessionToken
 * @param {object} job          - sync_jobs row
 * @returns {Promise<Array>}
 */
async function fetchDetailAllocations(entityConfig, connection, sessionToken, job) {
  const { restEndpoint, parentTable, parentIdField } = entityConfig;

  // Fetch all parent API IDs already synced for this org+integration
  const { data: parentRows, error } = await supabaseAdmin
    .from(parentTable)
    .select(parentIdField)
    .eq('organization_id', job.organization_id)
    .eq('platform_integration_id', connection.id);

  if (error) throw new Error(`Failed to fetch parent IDs from ${parentTable}: ${error.message}`);

  const parentIds = (parentRows || []).map(r => r[parentIdField]).filter(Boolean);
  console.log(`[IplicitEngine] ${entityConfig.alias}: fetching allocations for ${parentIds.length} ${parentTable} records`);

  const allAllocations = [];
  for (const parentId of parentIds) {
    try {
      const detail = await fetchRestApiById(connection.client_id, sessionToken, restEndpoint, parentId);
      const allocations = Array.isArray(detail?.allocations) ? detail.allocations : [];
      for (const alloc of allocations) {
        allAllocations.push({ ...alloc, _parentId: parentId });
      }
    } catch (e) {
      console.warn(`[IplicitEngine] Detail fetch failed for ${restEndpoint}/${parentId}: ${e.message}`);
    }
  }

  // Deduplicate only on (parentId + allocation_id) — same allocation can legitimately
  // appear under different parents (different receipt_id/payment_id) with different data,
  // so we keep those. Only drop exact same parent+allocation pairs.
  const seen = new Set();
  const unique = allAllocations.filter(a => {
    const key = `${a._parentId}::${a.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[IplicitEngine] ${entityConfig.alias}: ${unique.length} allocations fetched (${allAllocations.length - unique.length} exact duplicates removed)`);
  return unique;
}

/**
 * Resolve the platform_integration_organizations UUID for the org.
 * This is the UUID (id) of the row in platform_integration_organizations
 * mapped to this org via platform_integration_organization_mapping.
 *
 * @param {string} organizationId
 * @returns {Promise<string|null>}
 */
async function resolvePlatformIntegrationOrgId(organizationId) {
  try {
    const { data: mapping } = await supabaseAdmin
      .from('platform_integration_organization_mapping')
      .select('platform_integration_organizations_id')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();

    return mapping?.platform_integration_organizations_id || null;
  } catch (e) {
    console.warn(`[IplicitEngine] Could not resolve org mapping: ${e.message}`);
    return null;
  }
}

/**
 * Process a single Iplicit sync job.
 *
 * @param {object} job          - sync_jobs row
 * @param {object} connection   - platform_integrations row
 * @param {Map}    cancelTokens - Map<jobId, boolean>
 * @returns {Promise<void|'retry'|'failed'>}
 */
async function processIplicitSyncJob(job, connection, cancelTokens) {
  const entityAlias = job.entity_alias || 'coa_account_groups';
  console.log(`[IplicitEngine] Starting job ${job.id}: ${entityAlias}`);

  try {
    await logger.markRunning(job.id);

    // Check cancellation
    if (cancelTokens.get(job.id)) {
      await logger.markCancelled(job.id);
      return;
    }

    // Authenticate — get or refresh session token
    const { sessionToken } = await getOrRefreshSession(
      connection.id,
      connection.client_id,    // domain
      connection.username,       // username
      connection.client_secret,  // apiKey
      connection.access_token,
      connection.token_expires_at
    );

    console.log(`[IplicitEngine] ${entityAlias}: fetching records...`);

    // Build body params and top limit from entity config
    const entityConfig = ENTITY_BY_ALIAS[entityAlias] || {};
    const topLimit = entityConfig.topLimit || 1000;
    const bodyParams = entityConfig.dateFilter ? {
      PeriodDateFrom: job.start_date,
      PeriodDateTo:   job.end_date,
      Currency:       'GBP',
    } : {};

    // Fetch all records
    let rawRecords;
    if (entityConfig.fetchType === 'detail_allocations') {
      rawRecords = await fetchDetailAllocations(entityConfig, connection, sessionToken, job);
    } else {
      rawRecords = await fetchEntityRecords(
        entityAlias,
        connection.client_id,
        sessionToken,
        bodyParams,
        topLimit,
        entityConfig.dateFilter ? job.start_date : null,
        entityConfig.dateFilter ? job.end_date   : null,
      );
    }
    console.log(`[IplicitEngine] ${entityAlias}: ${rawRecords.length} records received`);

    // Warn if Enquiry response hit the top limit (data may be truncated)
    if (entityConfig.fetchType !== 'rest_api_paged' && entityConfig.fetchType !== 'legal_entities' && rawRecords.length === topLimit) {
      console.warn(`[IplicitEngine] ${entityAlias}: response hit topLimit (${topLimit}) — data may be truncated`);
    }

    if (rawRecords.length === 0) {
      await logger.markCompleted(job.id, {
        recordsProcessed: 0,
        recordsFailed: 0,
        currentPage: 1,
        totalPages: 1,
      });
      console.log(`[IplicitEngine] ${entityAlias}: 0 records — nothing to sync`);
      return;
    }

    // Check cancellation before upsert
    if (cancelTokens.get(job.id)) {
      await logger.markCancelled(job.id);
      return;
    }

    // Resolve platform_integration_organization_id (nullable FK)
    const platformIntegrationOrgId = await resolvePlatformIntegrationOrgId(job.organization_id);

    // Build transform context
    const ctx = {
      organizationId: job.organization_id,
      userId: job.user_id,
      platformIntegrationId: connection.id,
      platformIntegrationOrgId,
      // Date range params (populated for dateFilter entities, null for reference entities)
      periodDateFrom: job.start_date || null,
      periodDateTo:   job.end_date   || null,
      currency:       'GBP',
    };

    // Transform all records
    const transformed = [];
    let transformFailed = 0;
    for (const record of rawRecords) {
      try {
        const row = transformRecord(entityAlias, record, ctx);
        if (row) transformed.push(row);
      } catch (err) {
        console.error(`[IplicitEngine] Transform error for ${entityAlias}:`, err.message);
        transformFailed++;
      }
    }

    console.log(`[IplicitEngine] ${entityAlias}: ${transformed.length} transformed (${transformFailed} transform errors)`);

    // Upsert to database
    const tableName = TABLE_MAP[entityAlias];
    const onConflict = ON_CONFLICT_MAP[entityAlias];
    const { processed, failed: upsertFailed } = await batchUpsert(tableName, onConflict, transformed);
    const totalFailed = transformFailed + upsertFailed;

    // Canonical finance_accounts from iplicit_chart_of_accounts (platform-agnostic reporting layer)
    if (entityAlias === 'iplicit_chart_of_accounts' && processed > 0) {
      try {
        const sourceId = await ensureFinanceDataSource(job.organization_id, connection.id);
        if (sourceId) {
          const canon = await syncAccountsFromIplicitChartTable(
            job.organization_id,
            sourceId,
            connection.id
          );
          console.log(`[IplicitEngine] Canonical COA rows upserted: ${canon.upserted}`);
        }
      } catch (canonErr) {
        console.warn('[IplicitEngine] Canonical COA sync failed (non-fatal):', canonErr?.message || canonErr);
      }
    }

    // Canonical finance_journal_entries / lines from iplicit PL+BS staging.
    // Run after either PL or BS sync to keep canonical journals refreshed for local backend-triggered sync.
    if (
      (entityAlias === 'iplicit_profit_loss' || entityAlias === 'iplicit_balance_sheet') &&
      processed > 0
    ) {
      try {
        const sourceId = await ensureFinanceDataSource(job.organization_id, connection.id);
        if (sourceId) {
          const canonJournal = await syncJournalsFromIplicitReportTables(
            job.organization_id,
            sourceId,
            connection.id
          );
          if (canonJournal.error) {
            console.warn('[IplicitEngine] Canonical journals sync failed (non-fatal):', canonJournal.error);
          } else {
            console.log(
              `[IplicitEngine] Canonical journals synced: rows=${canonJournal.sourceRowCount}, ` +
              `entries=${canonJournal.journalEntriesUpserted}, lines=${canonJournal.journalLinesUpserted}, ` +
              `lineCandidates=${canonJournal.mappedLineCandidates ?? 'n/a'}, ` +
              `skipNoAccount=${canonJournal.skippedNoAccount ?? 'n/a'}, ` +
              `skipNoJournalMap=${canonJournal.skippedNoJournalMap ?? 'n/a'}` +
              (canonJournal.skippedReason ? ` (${canonJournal.skippedReason})` : '')
            );
          }
        }
      } catch (canonErr) {
        console.warn('[IplicitEngine] Canonical journal sync exception (non-fatal):', canonErr?.message || canonErr);
      }
    }

    // Mark job completed
    await logger.markCompleted(job.id, {
      recordsProcessed: processed,
      recordsFailed: totalFailed,
      currentPage: 1,
      totalPages: 1,
    });

    // Update last_synced_at on the connection
    await supabaseAdmin
      .from('platform_integrations')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', connection.id);

    console.log(`[IplicitEngine] ${entityAlias}: ${processed} records synced, ${totalFailed} failed`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[IplicitEngine] Job ${job.id} error:`, errorMessage);

    const retryCount = (job.retry_count || 0) + 1;
    const maxRetries = job.max_retries || 3;

    if (retryCount <= maxRetries) {
      console.log(`[IplicitEngine] Queuing job ${job.id} for retry (${retryCount}/${maxRetries})`);
      await logger.markRetry(job.id, retryCount, errorMessage);
      return 'retry';
    } else {
      await logger.markFailed(job.id, errorMessage);
      return 'failed';
    }
  }
}

module.exports = { processIplicitSyncJob };
