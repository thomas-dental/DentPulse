/**
 * Refresh Xero data that cashflow-report depends on:
 *   1) xero_balance_sheet  — month-end cash anchors
 *   2) xero_journals       — Received / Paid movements (+ journal details)
 *
 * Usage:
 *   node backend/scripts/triggerXeroCashflowRefresh.js <organization_id> [connection_id]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { supabaseAdmin } = require('../config/supabase');
const { processXeroSyncJob } = require('../queue/xero/processor');
const settingsStore = require('../services/sync/settingsStore');

const ORG_ID = process.argv[2];
const CONNECTION_ID = process.argv[3] || null;
const ENTITIES = ['xero_balance_sheet', 'xero_journals'];

if (!ORG_ID) {
  console.error('Usage: node triggerXeroCashflowRefresh.js <organization_id> [connection_id]');
  process.exit(1);
}

async function getXeroDateRange() {
  try {
    const s = await settingsStore.refresh();
    return { startDate: s.xero_start_date || null, endDate: s.xero_end_date || null };
  } catch {
    return { startDate: null, endDate: null };
  }
}

async function countRows(table, orgId, connectionId) {
  const { count } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('platform_integration_id', connectionId);
  return count ?? 0;
}

async function main() {
  let connectionQuery = supabaseAdmin
    .from('platform_integrations')
    .select('id, access_token, refresh_token, token_expires_at, is_connected')
    .eq('organization_id', ORG_ID)
    .eq('platform_name', 'xero')
    .eq('is_connected', true)
    .not('access_token', 'is', null);

  if (CONNECTION_ID) connectionQuery = connectionQuery.eq('id', CONNECTION_ID);

  const { data: connection, error: connError } = await connectionQuery.limit(1).maybeSingle();
  if (connError || !connection) {
    throw new Error(
      CONNECTION_ID
        ? `No connected Xero integration found for connection ${CONNECTION_ID}`
        : 'No connected Xero integration found for this organization',
    );
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('user_id')
    .eq('id', ORG_ID)
    .single();
  const userId = org?.user_id || null;

  const { startDate, endDate } = await getXeroDateRange();
  console.log(
    `[triggerXeroCashflowRefresh] org=${ORG_ID} connection=${connection.id} range=${startDate}→${endDate}`,
  );

  for (const entityAlias of ENTITIES) {
    console.log(`\n=== ${entityAlias} ===`);
    const before = await countRows(
      entityAlias === 'xero_journals' ? 'xero_journals' : 'xero_balance_sheet',
      ORG_ID,
      connection.id,
    );
    console.log(`rows before: ${before}`);

    const { data: jobs, error: insertError } = await supabaseAdmin
      .from('sync_jobs')
      .insert({
        organization_id: ORG_ID,
        integration_id: connection.id,
        user_id: userId,
        job_type: 'entity_sync',
        entity_alias: entityAlias,
        status: 'queued',
        progress_percentage: 0,
        current_page: 1,
        records_processed: 0,
        records_failed: 0,
        retry_count: 0,
        max_retries: 3,
        start_date: startDate,
        end_date: endDate,
      })
      .select();

    if (insertError || !jobs?.length) {
      throw new Error(`Failed to create ${entityAlias} job: ${insertError?.message || 'unknown'}`);
    }

    const job = jobs[0];
    console.log(`Processing job ${job.id}...`);
    await processXeroSyncJob(job, connection, new Map());

    const after = await countRows(
      entityAlias === 'xero_journals' ? 'xero_journals' : 'xero_balance_sheet',
      ORG_ID,
      connection.id,
    );
    console.log(`rows after: ${after}`);
  }

  // Quick month-end cash coverage check for recent months
  const { data: bsRows } = await supabaseAdmin
    .from('xero_balance_sheet')
    .select('to_date')
    .eq('organization_id', ORG_ID)
    .eq('platform_integration_id', connection.id)
    .gte('to_date', '2026-01-01')
    .order('to_date', { ascending: true });

  const ends = [...new Set((bsRows || []).map((r) => String(r.to_date).slice(0, 10)))];
  console.log('\nBalance Sheet month-ends from 2026-01:', ends);

  const { count: julJournals } = await supabaseAdmin
    .from('xero_journals')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', ORG_ID)
    .eq('platform_integration_id', connection.id)
    .gte('journal_date', '2026-07-01')
    .lte('journal_date', '2026-07-31');
  console.log(`xero_journals in Jul-26: ${julJournals ?? 0}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
