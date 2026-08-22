/**
 * One-off: fix stuck Dentally jobs + force Xero download for
 * "The Old Surgery Dental Practice" (Chirag Soni).
 *
 * Usage: node backend/scripts/syncOldSurgery.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { supabaseAdmin } = require('../config/supabase');
const dentallyQueue = require('../queue/jobQueue');
const xeroQueue = require('../queue/xero/jobQueue');
const settingsStore = require('../services/sync/settingsStore');

const ORG_ID = '739fb423-9aa5-46ae-8b6e-71f147d72530';
const DENTALLY_INT = '43dcb7cb-159c-4208-a272-08efe5aeb768';
const XERO_INT = '8d5be16e-2299-432f-80a6-63a6397c5e8f';

async function waitForJobs(integrationId, label, timeoutMs = 4 * 60 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data: active } = await supabaseAdmin
      .from('sync_jobs')
      .select('id, entity_alias, status, records_processed, current_page')
      .eq('organization_id', ORG_ID)
      .eq('integration_id', integrationId)
      .in('status', ['queued', 'running']);

    const count = active?.length || 0;
    if (count === 0) {
      console.log(`[wait] ${label}: all jobs finished`);
      return;
    }

    const summary = (active || [])
      .map((j) => `${j.entity_alias}:${j.status}:p${j.current_page}:n${j.records_processed}`)
      .join(' | ');
    console.log(`[wait] ${label}: ${count} active — ${summary}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error(`[wait] ${label}: timed out`);
}

async function main() {
  // Settings are DB-backed; warm cache before queue/date-range reads.
  try {
    await settingsStore.refresh();
  } catch (e) {
    console.warn('[syncOldSurgery] settings refresh failed (non-fatal):', e.message);
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, user_id')
    .eq('id', ORG_ID)
    .single();
  if (!org) throw new Error(`Org ${ORG_ID} not found`);
  console.log(`[syncOldSurgery] Org: ${org.name} (${org.id})`);

  // Verify Dentally integration is visible with current service key
  const { data: dentally, error: dentErr } = await supabaseAdmin
    .from('integrations')
    .select('id, integration_name, is_connected, deleted_at')
    .eq('id', DENTALLY_INT)
    .eq('organization_id', ORG_ID)
    .is('deleted_at', null)
    .single();
  if (dentErr || !dentally) {
    throw new Error(`Dentally integration lookup failed: ${dentErr?.message || 'not found'}`);
  }
  console.log(`[syncOldSurgery] Dentally OK: ${dentally.id}`);

  const { data: xero, error: xeroErr } = await supabaseAdmin
    .from('platform_integrations')
    .select('id, platform_name, is_connected')
    .eq('id', XERO_INT)
    .eq('organization_id', ORG_ID)
    .eq('is_connected', true)
    .single();
  if (xeroErr || !xero) {
    throw new Error(`Xero connection lookup failed: ${xeroErr?.message || 'not found'}`);
  }
  console.log(`[syncOldSurgery] Xero OK: ${xero.id}`);

  // ── 1) Clear stuck Dentally running jobs so resume can proceed ────────────
  const { data: stuck } = await supabaseAdmin
    .from('sync_jobs')
    .select('id, entity_alias, status')
    .eq('organization_id', ORG_ID)
    .eq('integration_id', DENTALLY_INT)
    .in('status', ['queued', 'running']);

  if (stuck?.length) {
    console.log(`[syncOldSurgery] Cancelling ${stuck.length} stuck Dentally job(s)...`);
    await dentallyQueue.cancelJobsForIntegration(ORG_ID, DENTALLY_INT);
  }

  // ── 2) Force full Xero download for Old Surgery ───────────────────────────
  console.log('\n=== Xero force sync ===');
  const xeroResult = await xeroQueue.triggerSync(ORG_ID, null, org.user_id, true, XERO_INT);
  console.log(`[syncOldSurgery] Xero jobs created: ${xeroResult.jobCount} (skipped ${xeroResult.skipped})`);
  await waitForJobs(XERO_INT, 'Xero', 90 * 60 * 1000);

  // ── 3) Continue Dentally sync (skip already-completed month chunks) ───────
  console.log('\n=== Dentally sync (resume incomplete) ===');
  const dentResult = await dentallyQueue.triggerSync(ORG_ID, null, org.user_id, false, {
    integrationId: DENTALLY_INT,
  });
  console.log(`[syncOldSurgery] Dentally jobs created: ${dentResult.jobCount} (skipped ${dentResult.skipped})`);
  await waitForJobs(DENTALLY_INT, 'Dentally', 4 * 60 * 60 * 1000);

  // Summary
  const { data: recentXero } = await supabaseAdmin
    .from('sync_jobs')
    .select('entity_alias, status, records_processed, error_message, updated_at')
    .eq('organization_id', ORG_ID)
    .eq('integration_id', XERO_INT)
    .order('updated_at', { ascending: false })
    .limit(20);

  console.log('\n=== Xero latest jobs ===');
  for (const j of recentXero || []) {
    console.log(`  ${j.entity_alias.padEnd(28)} ${j.status.padEnd(12)} n=${j.records_processed} ${j.error_message || ''}`);
  }

  console.log('\n[syncOldSurgery] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[syncOldSurgery] FAILED:', err.message);
  process.exit(1);
});
