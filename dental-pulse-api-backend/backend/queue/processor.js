/**
 * Sync engine - processes a single sync job by fetching ALL pages for that entity/date-range.
 *
 * Unlike the edge function (which processes one page per invocation),
 * this engine loops through all pages in a single run.
 */

const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../config/supabase');
const { fetchDentallyPage, fetchInvoiceDetailsBatch, fetchAccountDetailsBatch, fetchPatientById, extractRecords, PER_PAGE, getInvoiceBatchConcurrency } = require('../api/dentally/client');
const { sleep } = require('../utils/helpers');
const {
  upsertEntityData,
  getCategoryMap,
  getLocationMap,
  getCancellationReasonMap,
  getAcquisitionSourceMap,
  invalidateMapCaches,
} = require('../services/sync/upsert');
const { ENTITIES_NEEDING_LOCATION_MAP } = require('../api/dentally/config');
const { chunkLabel } = require('../utils/dateHelpers');
const logger = require('../services/sync/logger');
const { decryptIntegrationPat } = require('../services/patientEconomics/integrationPat');

const { getSyncSettings } = require('../services/sync/settingsStore');
const {
  schedulePeFactsRefreshWhenLegacySyncBatchIdle,
} = require('../services/patientEconomics/legacySyncFactsRefresh');

function notifyLegacySyncBatchJobTerminal(job) {
  schedulePeFactsRefreshWhenLegacySyncBatchIdle({
    practiceId: job.organization_id,
    integrationId: job.integration_id,
  });
}

function readSyncMode() {
  try {
    return getSyncSettings().sync_mode || 'current';
  } catch {
    return 'current';
  }
}

// Safety limit: max pages per job to prevent infinite loops
// If API doesn't return total_pages and data is huge, stop after this many pages
const MAX_PAGES_PER_JOB = 5000;

/**
 * Process a single sync job (all pages).
 *
 * @param {object} job - sync_jobs row
 * @param {object} integration - integrations row { id, encrypted_pat, encrypted_pat_iv, api_endpoints }
 * @param {object} cancelTokens - Map<jobId, boolean> for cancellation
 * @returns {Promise<void>}
 */
async function processSyncJob(job, integration, cancelTokens) {
  const entityAlias = job.entity_alias || 'appointments';
  const dateLabel = job.start_date ? ` for ${chunkLabel(job.start_date)}` : '';
  console.log(`[SyncEngine] Starting job ${job.id}: ${entityAlias}${dateLabel}`);

  let dentallyPat;
  try {
    dentallyPat = decryptIntegrationPat(integration);
  } catch (err) {
    console.error(`[SyncEngine] Job ${job.id}: ${err.message}`);
    await logger.markFailed(job.id, err.message);
    notifyLegacySyncBatchJobTerminal(job);
    return;
  }

  try {
    await logger.markRunning(job.id);

    // Pre-load maps once for the whole job
    const maps = {};
    if (entityAlias === 'treatments') {
      maps.categoryMap = await getCategoryMap(job.organization_id);
    }
    if (ENTITIES_NEEDING_LOCATION_MAP.includes(entityAlias)) {
      maps.locationMap = await getLocationMap(job.organization_id);
    }
    if (entityAlias === 'appointments' || entityAlias === 'appointments_current_month') {
      maps.cancellationReasonMap = await getCancellationReasonMap(job.organization_id);
    }
    if (entityAlias === 'patients') {
      maps.acquisitionSourceMap = await getAcquisitionSourceMap(job.organization_id);
    }

    // Resume from last saved page (on retry, skip already-processed pages)
    const isRetry = (job.retry_count || 0) > 0 && (job.current_page || 1) > 1;
    let currentPage = job.current_page || 1;
    if (isRetry) {
      // Start from next page after last successfully saved page
      currentPage = currentPage + 1;
      console.log(`[SyncEngine] Retry #${job.retry_count}: resuming ${entityAlias} from page ${currentPage}`);
    }
    let totalProcessed = job.records_processed || 0;
    let totalFailed = job.records_failed || 0;
    let knownTotalPages = job.total_pages || null;
    let knownApiTotal = null;
    let totalDuplicatesSkipped = 0;

    // Track seen record IDs to prevent duplicates across pages
    // (unstable API pagination without sort_by can return the same record on different pages)
    const seenRecordIds = new Set();

    // Track Dentally site_ids seen in the API response for this job. Used to
    // scope the invoice stale-cleanup so that one Dentally integration can't
    // soft-delete invoices that belong to a sibling integration in the same org.
    const seenSiteIds = new Set();

    // Resolve entity config override once for this job (historical mode for appointments)
    let entityConfigOverride = null;
    if (entityAlias === 'appointments') {
      const syncMode = readSyncMode();
      if (syncMode === 'historical') {
        entityConfigOverride = { dateFilter: 'after', dateFilterEnd: 'before', sortBy: 'start_time' };
        console.log(`[SyncEngine] Historical mode — appointments using after/before (start_time) filter`);
      }
    }

    // Fetch all pages
    while (true) {
      // Check cancellation
      if (cancelTokens.get(job.id)) {
        console.log(`[SyncEngine] Job ${job.id} cancelled`);
        await logger.markCancelled(job.id);
        return;
      }

      console.log(`[SyncEngine] ${entityAlias}${dateLabel} - page ${currentPage}...`);

      const responseData = await fetchDentallyPage(
        dentallyPat,
        integration.api_endpoints,
        entityAlias,
        currentPage,
        job.start_date,
        job.end_date,
        entityConfigOverride
      );

      let { records, totalPages, total } = extractRecords(responseData, entityAlias);
      if (totalPages) knownTotalPages = totalPages;
      if (total != null) knownApiTotal = total;

      // Track raw page size BEFORE any filtering — used for pagination detection
      const rawPageSize = records.length;

      console.log(`[SyncEngine] ${entityAlias}${dateLabel} page ${currentPage}: ${records.length} records`);

      // Store ALL invoices (paid and unpaid) so that invoices paid AFTER their
      // initial sync are captured when re-synced. The is_paid flag and paid_date
      // are stored in DB; frontends filter by is_paid=true at query time.
      // Previously we filtered out unpaid invoices here, which caused invoices
      // paid after their dated_on month chunk was synced to be permanently missing.

      // Deduplicate: remove records already seen on previous pages
      const beforeDedup = records.length;
      records = records.filter(record => {
        const recordId = record.uuid || record.id;
        if (recordId == null) return true; // no ID to deduplicate on, keep it
        const key = String(recordId);
        if (seenRecordIds.has(key)) return false; // duplicate, skip
        seenRecordIds.add(key);
        // For invoices, remember which Dentally site_id the record is from so
        // the stale-cleanup below can scope deletions to this integration.
        if (entityAlias === 'invoices' && record.site_id) seenSiteIds.add(String(record.site_id));
        return true;
      });
      const duplicatesOnPage = beforeDedup - records.length;
      if (duplicatesOnPage > 0) {
        totalDuplicatesSkipped += duplicatesOnPage;
        console.log(`[SyncEngine] ${entityAlias}${dateLabel} page ${currentPage}: skipped ${duplicatesOnPage} duplicates (${totalDuplicatesSkipped} total duplicates)`);
      }

      // For invoices, fetch detail in parallel batches to get invoice_items
      if (entityAlias === 'invoices' && records.length > 0) {
        const batchSize = getInvoiceBatchConcurrency(dentallyPat);
        console.log(`[SyncEngine] Fetching detail for ${records.length} invoices (parallel, concurrency=${batchSize})...`);
        const cancelCheck = () => cancelTokens.get(job.id) === true;
        records = await fetchInvoiceDetailsBatch(
          dentallyPat,
          integration.api_endpoints,
          records,
          cancelCheck
        );

        // Check if cancelled during invoice detail fetch
        if (cancelTokens.get(job.id)) {
          console.log(`[SyncEngine] Job ${job.id} cancelled during invoice detail fetch`);
          await logger.markCancelled(job.id);
          return;
        }

        console.log(`[SyncEngine] Fetched details for ${records.length} invoices`);
      }

      // For accounts, fetch detail in parallel batches to get `uuid` (not
      // returned by the list endpoint; we need it for Dentally deep links).
      if (entityAlias === 'accounts' && records.length > 0) {
        const batchSize = getInvoiceBatchConcurrency(dentallyPat);
        console.log(`[SyncEngine] Fetching detail for ${records.length} accounts (parallel, concurrency=${batchSize})...`);
        const cancelCheck = () => cancelTokens.get(job.id) === true;
        records = await fetchAccountDetailsBatch(
          dentallyPat,
          integration.api_endpoints,
          records,
          cancelCheck
        );

        if (cancelTokens.get(job.id)) {
          console.log(`[SyncEngine] Job ${job.id} cancelled during account detail fetch`);
          await logger.markCancelled(job.id);
          return;
        }

        console.log(`[SyncEngine] Fetched details for ${records.length} accounts`);
      }

      if (records.length > 0) {
        const { processed, failed } = await upsertEntityData(
          entityAlias,
          job.organization_id,
          job.user_id,
          records,
          maps,
          integration.id,
          integration.synced_site_ids
        );
        totalProcessed += processed;
        totalFailed += failed;

        // After upserting invoices, sync any missing patients referenced by patient_id
        if (entityAlias === 'invoices') {
          await syncMissingPatientsFromInvoices(
            records, job.organization_id, job.user_id, integration, maps
          );
        }

        // After upserting treatment_plan_items, resolve location_id from appointment chain
        // (Dentally API doesn't return site_id for TPIs, so location_id is always NULL after sync)
        if (entityAlias === 'treatment_plan_items') {
          await resolveTpiLocationsFromAppointments(records, job.organization_id);
        }

        // After upserting accounts, resolve location_id from the patient
        // (Dentally /v1/accounts doesn't return site_id, so location_id is NULL after sync)
        if (entityAlias === 'accounts') {
          await resolveAccountLocationsFromPatients(records, job.organization_id, integration.id);
        }
      }

      // Check if last page
      // Also stop if all records on this page were duplicates (pagination has looped)
      const allDuplicates = beforeDedup > 0 && records.length === 0;
      // Use rawPageSize (before paid/dedup filtering) for pagination check,
      // otherwise filtering out unpaid invoices could prematurely stop pagination.
      const isLastPage = allDuplicates || (knownTotalPages
        ? currentPage >= knownTotalPages
        : rawPageSize < PER_PAGE);

      if (allDuplicates) {
        console.log(`[SyncEngine] ${entityAlias}${dateLabel}: page ${currentPage} returned all duplicates — stopping pagination`);
      }

      // Safety limit: prevent infinite loops if API never returns < PER_PAGE records
      if (currentPage >= MAX_PAGES_PER_JOB && !isLastPage) {
        console.warn(`[SyncEngine] ${entityAlias}${dateLabel}: Hit max pages limit (${MAX_PAGES_PER_JOB}). Stopping.`);
        break;
      }

      // Update progress in DB every 10 pages or on last page (reduces Disk IO on free tier)
      if (currentPage % 10 === 0 || isLastPage) {
        await logger.updatePageProgress(job.id, {
          currentPage,
          totalPages: knownTotalPages,
          recordsProcessed: totalProcessed,
          recordsFailed: totalFailed,
        });
      }

      if (isLastPage) break;

      currentPage++;

      // Delay between pages to spread IO and stay within Supabase free-tier Disk IO budget
      await sleep(200);
    }

    // Pagination sanity check: if Dentally meta.total exceeds the unique
    // record count we actually saw, the API skipped rows across pages —
    // usually caused by missing or unstable sort_by. Warn loudly so the
    // gap doesn't silently persist in the DB.
    if (knownApiTotal != null && seenRecordIds.size > 0 && seenRecordIds.size < knownApiTotal) {
      const gap = knownApiTotal - seenRecordIds.size;
      console.warn(
        `[SyncEngine] ${entityAlias}${dateLabel}: pagination dropped ${gap} record(s) ` +
        `(Dentally meta.total=${knownApiTotal}, unique seen=${seenRecordIds.size}). ` +
        `Check entity sortBy in api/dentally/config.js.`
      );
    }

    // Soft-delete invoices that Dentally no longer returns (voided/replaced).
    // Scoped by the site_ids this job actually saw, so a sibling integration's
    // invoices can't be collateral damage when an org connects multiple
    // Dentally accounts (different locations → different site_ids).
    //
    // Skip cleanup entirely when we didn't see any site_ids — that usually
    // means the date range has no activity and we can't distinguish "voided"
    // from "wrong integration" safely.
    if (
      entityAlias === 'invoices' &&
      job.start_date && job.end_date &&
      seenRecordIds.size > 0 &&
      seenSiteIds.size > 0
    ) {
      try {
        const siteIdList = [...seenSiteIds];
        const { data: dbInvoices, error: fetchErr } = await supabaseAdmin
          .from('platform_integration_invoices')
          .select('id, platform_invoice_id')
          .eq('organization_id', job.organization_id)
          .eq('platform_type', 'dentally')
          .in('site_id', siteIdList)
          .is('deleted_at', null)
          .gte('invoice_date', job.start_date)
          .lte('invoice_date', job.end_date);

        if (!fetchErr && dbInvoices && dbInvoices.length > 0) {
          const staleInvoices = dbInvoices.filter(
            inv => !seenRecordIds.has(String(inv.platform_invoice_id))
          );

          if (staleInvoices.length > 0) {
            const staleIds = staleInvoices.map(inv => inv.id);
            const staleNow = new Date().toISOString();

            const { error: delErr } = await supabaseAdmin
              .from('platform_integration_invoices')
              .update({ deleted_at: staleNow, is_paid: false, status: 'voided' })
              .in('id', staleIds);

            if (delErr) {
              console.error(`[SyncEngine] Error soft-deleting stale invoices: ${delErr.message}`);
            } else {
              console.log(`[SyncEngine] Soft-deleted ${staleInvoices.length} stale/voided invoices (sites=${siteIdList.join(',')}): ${staleInvoices.map(i => i.platform_invoice_id).join(', ')}`);
            }
          }
        }
      } catch (err) {
        console.error(`[SyncEngine] Error during stale invoice cleanup: ${err.message}`);
      }
    }

    // Mark completed
    await logger.markCompleted(job.id, {
      recordsProcessed: totalProcessed,
      recordsFailed: totalFailed,
      currentPage,
      totalPages: knownTotalPages || currentPage,
    });

    // Update last_synced_at on the specific sync entity
    const now = new Date().toISOString();
    await supabaseAdmin
      .from('integration_sync_entities')
      .update({ last_synced_at: now })
      .eq('integration_id', integration.id)
      .eq('entity_alias', entityAlias);

    // Invalidate map caches after reference entities are synced so subsequent jobs get fresh data
    if (
      entityAlias === 'locations'
      || entityAlias === 'treatment_category'
      || entityAlias === 'treatments'
      || entityAlias === 'appointment_cancellation_reasons'
      || entityAlias === 'acquisition_sources'
    ) {
      invalidateMapCaches(job.organization_id);
    }

    const dedupMsg = totalDuplicatesSkipped > 0 ? `, ${totalDuplicatesSkipped} duplicates skipped` : '';
    console.log(`[SyncEngine] ${entityAlias}${dateLabel}: ${totalProcessed} records synced, ${totalFailed} failed${dedupMsg}`);

    notifyLegacySyncBatchJobTerminal(job);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[SyncEngine] Job ${job.id} error:`, errorMessage);

    // Rate limit exhausted: don't count as a retry, pause and re-queue
    if (error.isRateLimit || errorMessage === 'RATE_LIMIT_EXHAUSTED') {
      const resetAt = error.rateLimitResetAt || 0;
      const resetLabel = resetAt > Date.now()
        ? ` (resets at ${new Date(resetAt).toLocaleTimeString()})`
        : '';
      console.log(`[SyncEngine] Job ${job.id}: Rate limit exhausted${resetLabel}, pausing for re-queue (not counted as retry)`);
      await logger.markRetry(job.id, job.retry_count || 0, `Rate limit paused${resetLabel} — will resume automatically`);
      return { status: 'rate_limited', rateLimitResetAt: resetAt };
    }

    // Normal error: retry with count
    const retryCount = (job.retry_count || 0) + 1;
    const maxRetries = job.max_retries || 3;

    if (retryCount <= maxRetries) {
      console.log(`[SyncEngine] Queuing job ${job.id} for retry (${retryCount}/${maxRetries})`);
      await logger.markRetry(job.id, retryCount, errorMessage);
      return 'retry';
    } else {
      await logger.markFailed(job.id, errorMessage);
      notifyLegacySyncBatchJobTerminal(job);
      return 'failed';
    }
  }
}

/**
 * During invoice sync, check if patient_id on each invoice exists in the patients table.
 * If missing, fetch from Dentally API and upsert.
 */
async function syncMissingPatientsFromInvoices(invoiceRecords, organizationId, userId, integration, maps) {
  const patientIds = [...new Set(
    invoiceRecords.map(r => r.patient_id).filter(id => id != null)
  )];
  if (patientIds.length === 0) return;

  // Check which patients already exist
  const { data: existing, error } = await supabaseAdmin
    .from('patients')
    .select('pt_id')
    .eq('organization_id', organizationId)
    .in('pt_id', patientIds);

  if (error) {
    console.error('[SyncEngine] Error checking existing patients:', error.message);
    return;
  }

  const existingIds = new Set((existing || []).map(p => p.pt_id));
  const missingIds = patientIds.filter(id => !existingIds.has(id));
  if (missingIds.length === 0) return;

  console.log(`[SyncEngine] ${missingIds.length} missing patients from invoices, fetching from Dentally...`);

  const BATCH_SIZE = 10;
  const fetched = [];

  for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
    const batch = missingIds.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(pid => fetchPatientById(dentallyPat, integration.api_endpoints, pid))
    );
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) fetched.push(result.value);
    }
    if (i + BATCH_SIZE < missingIds.length) await sleep(100);
  }

  if (fetched.length === 0) return;

  const { processed, failed } = await upsertEntityData('patients', organizationId, userId, fetched, maps, integration.id);
  console.log(`[SyncEngine] Synced ${processed} missing patients from invoices (${failed} failed)`);
}

/**
 * After syncing treatment_plan_items, resolve their location_id from the appointment chain.
 * Dentally API doesn't return site_id on TPIs, so we derive it:
 *   TPI.tpi_treatment_appointment_id → treatment_appointments.ta_id
 *     → treatment_appointments.ta_appointment_id → appointments.apmt_id → appointments.location_id
 *
 * For TPIs without a TA link, fall back to matching by patient_id + completed_date → appointment location.
 */
async function resolveTpiLocationsFromAppointments(tpiRecords, organizationId) {
  // Collect tpi_id values from just-synced records that have no site_id
  const tpiIds = tpiRecords
    .filter(r => !r.site_id && r.id != null)
    .map(r => r.id);
  if (tpiIds.length === 0) return;

  // Fetch these TPIs from DB to get their tpi_treatment_appointment_id + tpi_practitioner_id
  const BATCH = 500;
  const tpisToResolve = [];
  for (let i = 0; i < tpiIds.length; i += BATCH) {
    const batch = tpiIds.slice(i, i + BATCH);
    const { data, error } = await supabaseAdmin
      .from('treatment_plan_items')
      .select('id, tpi_id, tpi_treatment_appointment_id, tpi_patient_id, tpi_practitioner_id, tpi_completed_at, location_id')
      .eq('organization_id', organizationId)
      .in('tpi_id', batch);
    if (error) { console.error('[TPI-Location] Error fetching TPIs:', error.message); continue; }
    // Resolve TPIs that have no location_id yet, OR that have a TA link
    // (appointment site wins) or a practitioner (home-site fallback).
    for (const row of (data || [])) {
      if (!row.location_id || row.tpi_practitioner_id != null || row.tpi_treatment_appointment_id != null) {
        tpisToResolve.push(row);
      }
    }
  }

  if (tpisToResolve.length === 0) return;

  // Collect unique treatment_appointment_ids
  const taIds = [...new Set(
    tpisToResolve
      .map(t => t.tpi_treatment_appointment_id)
      .filter(id => id != null)
      .map(Number)
  )];

  // Build ta_id → ta_appointment_id map
  const taToApptId = new Map();
  for (let i = 0; i < taIds.length; i += BATCH) {
    const batch = taIds.slice(i, i + BATCH);
    const { data } = await supabaseAdmin
      .from('treatment_appointments')
      .select('ta_id, ta_appointment_id')
      .eq('organization_id', organizationId)
      .in('ta_id', batch);
    for (const ta of (data || [])) {
      if (ta.ta_id != null && ta.ta_appointment_id != null) {
        taToApptId.set(Number(ta.ta_id), Number(ta.ta_appointment_id));
      }
    }
  }

  // Collect all appointment IDs we need to look up
  const apptIds = [...new Set([...taToApptId.values()])];

  // Build apmt_id → location_id map
  const apptLocMap = new Map();
  for (let i = 0; i < apptIds.length; i += BATCH) {
    const batch = apptIds.slice(i, i + BATCH);
    const { data } = await supabaseAdmin
      .from('appointments')
      .select('apmt_id, location_id')
      .eq('organization_id', organizationId)
      .in('apmt_id', batch);
    for (const a of (data || [])) {
      if (a.apmt_id != null && a.location_id) {
        apptLocMap.set(Number(a.apmt_id), a.location_id);
      }
    }
  }

  // Build practitioner+date → location map for fallback (Method 2)
  // and patient+date → location map for fallback (Method 3)
  // Collect unique dates from TPIs for the appointment query range
  const tpiDates = [...new Set(
    tpisToResolve
      .filter(t => t.tpi_completed_at)
      .map(t => t.tpi_completed_at.substring(0, 10))
  )].sort();

  const practDateLocMap = new Map(); // "practId|date" → location_id (only if unambiguous)
  const patDateLocMap = new Map(); // "patientId|date" → location_id (only if unambiguous)

  if (tpiDates.length > 0) {
    const minDate = tpiDates[0];
    const maxDate = tpiDates[tpiDates.length - 1];

    // Fetch appointments in the date range (paginated)
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabaseAdmin
        .from('appointments')
        .select('apmt_patient_id, apmt_practitioner_id, apmt_start_time, location_id')
        .eq('organization_id', organizationId)
        .not('location_id', 'is', null)
        .gte('apmt_start_time', minDate)
        .lte('apmt_start_time', maxDate + 'T23:59:59')
        .range(offset, offset + 999);
      for (const a of (data || [])) {
        if (!a.apmt_start_time) continue;
        const date = a.apmt_start_time.substring(0, 10);

        // Practitioner+date map
        if (a.apmt_practitioner_id) {
          const key = `${a.apmt_practitioner_id}|${date}`;
          if (!practDateLocMap.has(key)) practDateLocMap.set(key, a.location_id);
          else if (practDateLocMap.get(key) !== a.location_id) practDateLocMap.set(key, null);
        }

        // Patient+date map
        if (a.apmt_patient_id) {
          const key = `${a.apmt_patient_id}|${date}`;
          if (!patDateLocMap.has(key)) patDateLocMap.set(key, a.location_id);
          else if (patDateLocMap.get(key) !== a.location_id) patDateLocMap.set(key, null);
        }
      }
      hasMore = (data || []).length === 1000;
      offset += 1000;
    }
  }

  // Build practitioner primary location map (most frequent location per practitioner)
  // Used for Method 3 cross-check and Method 4 fallback
  const practLocCounts = new Map(); // practId → Map<locationId, count>
  const practIds = [...new Set(
    tpisToResolve.map(t => t.tpi_practitioner_id).filter(Boolean).map(Number)
  )];
  if (practIds.length > 0) {
    for (let i = 0; i < practIds.length; i += BATCH) {
      const batch = practIds.slice(i, i + BATCH);
      const { data } = await supabaseAdmin
        .from('appointments')
        .select('apmt_practitioner_id, location_id')
        .eq('organization_id', organizationId)
        .not('location_id', 'is', null)
        .in('apmt_practitioner_id', batch)
        .limit(5000);
      for (const a of (data || [])) {
        if (!practLocCounts.has(a.apmt_practitioner_id)) practLocCounts.set(a.apmt_practitioner_id, new Map());
        const lm = practLocCounts.get(a.apmt_practitioner_id);
        lm.set(a.location_id, (lm.get(a.location_id) || 0) + 1);
      }
    }
  }
  const practPrimaryLoc = new Map();
  for (const [pid, lm] of practLocCounts) {
    let best = null, bestCount = 0;
    for (const [lid, count] of lm) {
      if (count > bestCount) { best = lid; bestCount = count; }
    }
    if (best) practPrimaryLoc.set(pid, best);
  }

  // Method 5 prep: fetch patient.location_id for any patient tied to an
  // unresolved TPI, so we can fall back to the patient's registered site
  // when all appointment-based methods fail (common for charting TPIs).
  const patientIdsForFallback = [...new Set(
    tpisToResolve.map(t => t.tpi_patient_id).filter(Boolean).map(Number)
  )];
  const patientRegisteredLoc = new Map(); // pt_id → location_id
  if (patientIdsForFallback.length > 0) {
    for (let i = 0; i < patientIdsForFallback.length; i += BATCH) {
      const batch = patientIdsForFallback.slice(i, i + BATCH);
      const { data } = await supabaseAdmin
        .from('patients')
        .select('pt_id, location_id')
        .eq('organization_id', organizationId)
        .in('pt_id', batch)
        .not('location_id', 'is', null);
      for (const p of (data || [])) {
        if (p.pt_id != null && p.location_id) {
          patientRegisteredLoc.set(Number(p.pt_id), p.location_id);
        }
      }
    }
  }

  // Method 0 prep: fetch providers.location_id keyed by external_id (= Dentally
  // practitioner_id). This is the authoritative signal when a Dentally account
  // stores one practitioner record per site (common with multi-site setups),
  // because Dentally's own Practitioner Activity report filters by the
  // practitioner's site — not the appointment's site.
  const providerLoc = new Map(); // external_id (Number) → location_id
  if (practIds.length > 0) {
    for (let i = 0; i < practIds.length; i += BATCH) {
      const batch = practIds.slice(i, i + BATCH);
      const { data } = await supabaseAdmin
        .from('providers')
        .select('external_id, location_id')
        .eq('organization_id', organizationId)
        .in('external_id', batch)
        .not('location_id', 'is', null);
      for (const p of (data || [])) {
        if (p.external_id != null && p.location_id) {
          providerLoc.set(Number(p.external_id), p.location_id);
        }
      }
    }
  }

  // Resolve and batch-update TPI location_ids
  const updates = []; // { id, location_id }
  let viaProvider = 0, viaTA = 0, viaPract = 0, viaPat = 0, viaPractPrimary = 0, viaPatientReg = 0;

  for (const tpi of tpisToResolve) {
    let locId = null;
    const date = tpi.tpi_completed_at ? tpi.tpi_completed_at.substring(0, 10) : null;

    // Method 1 FIRST: TPI → TA → Appointment → Location.
    // Appointment site is where the treatment was delivered and is what
    // Dentally's site-filtered Practitioner Activity uses. Method 0
    // (practitioner home site) used to run first and mis-tagged cross-site
    // TPIs — Dimitra Jan-26: 3×£185 perio completed at Appoline but the TPI
    // carried the St Catherine's practitioner id, so Appoline net production
    // dropped them.
    const taId = tpi.tpi_treatment_appointment_id ? Number(tpi.tpi_treatment_appointment_id) : null;
    if (taId) {
      const apptId = taToApptId.get(taId);
      if (apptId) locId = apptLocMap.get(apptId) || null;
    }
    if (locId) {
      if (locId !== tpi.location_id) updates.push({ id: tpi.id, location_id: locId });
      viaTA++; continue;
    }

    // Method 0: providers.location_id by tpi_practitioner_id — fallback when
    // there is no appointment location (charting rows, missing TA link).
    if (tpi.tpi_practitioner_id != null) {
      const provLoc = providerLoc.get(Number(tpi.tpi_practitioner_id));
      if (provLoc) locId = provLoc;
    }
    if (locId) {
      if (locId !== tpi.location_id) updates.push({ id: tpi.id, location_id: locId });
      viaProvider++; continue;
    }

    // Methods 2-5 only run when there's no stored value yet — we don't want
    // a less-accurate method to overwrite a prior (and possibly manual) one.
    if (tpi.location_id) continue;

    // Method 2: Practitioner + completed_date → Appointment (only if unambiguous)
    if (tpi.tpi_practitioner_id && date) {
      const key = `${tpi.tpi_practitioner_id}|${date}`;
      const resolved = practDateLocMap.get(key);
      if (resolved) locId = resolved; // null means ambiguous, skip
    }
    if (locId) { updates.push({ id: tpi.id, location_id: locId }); viaPract++; continue; }

    // Method 3: Patient + completed_date → Appointment (only if unambiguous)
    // Cross-check: if practitioner's primary location differs from patient-date location,
    // skip to prevent wrong assignment (e.g. Rochester practitioner + Ashford patient)
    if (tpi.tpi_patient_id && date) {
      const key = `${tpi.tpi_patient_id}|${date}`;
      const resolved = patDateLocMap.get(key);
      if (resolved) {
        const practPrimary = tpi.tpi_practitioner_id ? practPrimaryLoc.get(Number(tpi.tpi_practitioner_id)) : null;
        if (!practPrimary || practPrimary === resolved) {
          locId = resolved;
        }
        // else: practitioner's primary location differs — skip to avoid mismatch
      }
    }
    if (locId) { updates.push({ id: tpi.id, location_id: locId }); viaPat++; continue; }

    // Method 4: Practitioner primary location (overall most frequent)
    if (tpi.tpi_practitioner_id) {
      locId = practPrimaryLoc.get(Number(tpi.tpi_practitioner_id)) || null;
    }
    if (locId) { updates.push({ id: tpi.id, location_id: locId }); viaPractPrimary++; continue; }

    // Method 5: Patient's registered location (patients.location_id)
    // Final fallback for charting/admin TPIs with no TA link and no same-date
    // appointment. Accurate for patients who attend their home site only;
    // may misattribute cross-site visits (accepted trade-off).
    if (tpi.tpi_patient_id) {
      locId = patientRegisteredLoc.get(Number(tpi.tpi_patient_id)) || null;
    }
    if (locId) { updates.push({ id: tpi.id, location_id: locId }); viaPatientReg++; }
  }

  if (updates.length === 0) {
    console.log(`[TPI-Location] No locations resolved for ${tpisToResolve.length} TPIs`);
    return;
  }

  // Batch update in groups
  let updated = 0;
  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100);
    // Use individual updates since Supabase doesn't support batch update by different values
    const results = await Promise.allSettled(
      batch.map(u =>
        supabaseAdmin
          .from('treatment_plan_items')
          .update({ location_id: u.location_id })
          .eq('id', u.id)
      )
    );
    updated += results.filter(r => r.status === 'fulfilled').length;
  }

  console.log(`[TPI-Location] Updated ${updated}/${tpisToResolve.length} TPI locations (${updates.length} resolved: provider=${viaProvider}, TA=${viaTA}, pract+date=${viaPract}, patient+date=${viaPat}, pract-primary=${viaPractPrimary}, patient-reg=${viaPatientReg})`);
}

/**
 * After syncing accounts, resolve their location_id from the patient.
 * Dentally /v1/accounts has no site_id, so the account row lands with
 * location_id NULL. Each account is 1:1 with a patient, so we just copy
 * patients.location_id over keyed by da_patient_id ↔ pt_id.
 *
 * CRITICAL: scope EVERY lookup by integration_id, not just organization_id.
 * Dentally pt_id is unique per integration, NOT per org — when an org has
 * multiple Dentally practices (e.g. South Street + Megor), the same pt_id
 * exists in each integration's patient set, each pointing to a different
 * location. Matching by org alone would cross-bleed locations between
 * practices. See memory: project_dentally_id_collision.
 */
async function resolveAccountLocationsFromPatients(accountRecords, organizationId, integrationId) {
  if (!integrationId) {
    console.warn('[Account-Location] integrationId missing — refusing to resolve to avoid cross-integration pt_id collisions');
    return;
  }

  // Just-synced accounts that have a patient_id we can resolve
  const patientIds = [...new Set(
    accountRecords
      .map(r => r.patient_id)
      .filter(id => id != null)
      .map(Number)
  )];

  // Fetch patient → location map in batches, scoped to the SAME integration.
  const BATCH = 500;
  const patientLocMap = new Map(); // pt_id (Number) → location_id
  if (patientIds.length > 0) {
    for (let i = 0; i < patientIds.length; i += BATCH) {
      const batch = patientIds.slice(i, i + BATCH);
      const { data, error } = await supabaseAdmin
        .from('patients')
        .select('pt_id, location_id')
        .eq('organization_id', organizationId)
        .eq('integration_id', integrationId)
        .in('pt_id', batch)
        .not('location_id', 'is', null);
      if (error) { console.error('[Account-Location] Error fetching patients:', error.message); continue; }
      for (const p of (data || [])) {
        if (p.pt_id != null && p.location_id) {
          patientLocMap.set(Number(p.pt_id), p.location_id);
        }
      }
    }
  }

  // Fallback: if THIS integration has exactly one practice_location, every
  // account in this integration must belong to it (single-site Dentally
  // accounts can't legitimately route anywhere else). Used when the patient
  // row isn't synced yet, has a null location_id, or the patient_id itself
  // is missing on the Dentally response.
  let singleLocFallback = null;
  {
    const { data: integrationLocs, error: locErr } = await supabaseAdmin
      .from('practice_locations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('integration_id', integrationId)
      .is('deleted_at', null);
    if (!locErr && integrationLocs && integrationLocs.length === 1) {
      singleLocFallback = integrationLocs[0].id;
    }
  }

  if (patientLocMap.size === 0 && !singleLocFallback) {
    console.log(`[Account-Location] No patient locations and no single-location fallback for integration ${integrationId.slice(0, 8)} — accounts left with NULL location_id`);
    return;
  }

  // Fetch the just-synced account rows so we have the DB UUID + current location_id.
  // Scope by integration_id so we only touch this integration's accounts.
  const accountDaIds = accountRecords
    .map(r => r.id)
    .filter(id => id != null)
    .map(Number);
  const accountsToUpdate = [];
  let viaPatient = 0, viaSingleLoc = 0;
  for (let i = 0; i < accountDaIds.length; i += BATCH) {
    const batch = accountDaIds.slice(i, i + BATCH);
    const { data, error } = await supabaseAdmin
      .from('dentally_patients_accounts')
      .select('id, da_id, da_patient_id, location_id')
      .eq('organization_id', organizationId)
      .eq('integration_id', integrationId)
      .in('da_id', batch);
    if (error) { console.error('[Account-Location] Error fetching accounts:', error.message); continue; }
    for (const a of (data || [])) {
      // Method 1: patient lookup (most accurate)
      let locId = a.da_patient_id != null ? patientLocMap.get(Number(a.da_patient_id)) : null;
      let viaSingle = false;
      // Method 2: single-location-integration fallback
      if (!locId && singleLocFallback) { locId = singleLocFallback; viaSingle = true; }
      if (!locId) continue;
      if (a.location_id === locId) continue; // unchanged, skip write
      accountsToUpdate.push({ id: a.id, location_id: locId });
      if (viaSingle) viaSingleLoc++; else viaPatient++;
    }
  }

  if (accountsToUpdate.length === 0) {
    console.log(`[Account-Location] All ${accountRecords.length} account(s) already had correct location_id (or no patient match)`);
    return;
  }

  // Batch the updates (Supabase doesn't support multi-row UPDATE with different
  // values in one call without an RPC, so fire updates per row, throttled).
  let updated = 0;
  for (let i = 0; i < accountsToUpdate.length; i += 100) {
    const chunk = accountsToUpdate.slice(i, i + 100);
    const results = await Promise.allSettled(
      chunk.map(u =>
        supabaseAdmin
          .from('dentally_patients_accounts')
          .update({ location_id: u.location_id })
          .eq('id', u.id)
      )
    );
    updated += results.filter(r => r.status === 'fulfilled').length;
  }
  console.log(`[Account-Location] Updated location_id on ${updated}/${accountsToUpdate.length} account(s) — patient=${viaPatient}, single-loc-fallback=${viaSingleLoc}`);
}

module.exports = { processSyncJob, resolveTpiLocationsFromAppointments };
