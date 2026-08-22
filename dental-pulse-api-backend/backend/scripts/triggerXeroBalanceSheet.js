/**
 * Fetch Xero Balance Sheet (cash/bank accounts) via REST API and upsert into
 * xero_balance_sheet. Runs inline — no HTTP server required.
 *
 * Usage:
 *   node backend/scripts/triggerXeroBalanceSheet.js <organization_id> [connection_id]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { supabaseAdmin } = require('../config/supabase');
const { processXeroSyncJob } = require('../queue/xero/processor');
const settingsStore = require('../services/sync/settingsStore');

const ORG_ID        = process.argv[2];
const CONNECTION_ID = process.argv[3] || null;

if (!ORG_ID) {
  console.error('Usage: node triggerXeroBalanceSheet.js <organization_id> [connection_id]');
  process.exit(1);
}

// Settings live in the DB now, so this must be awaited before use — unlike the
// server, this script has no boot step that pre-warms the settings cache.
async function getXeroDateRange() {
  try {
    const s = await settingsStore.refresh();
    return { startDate: s.xero_start_date || null, endDate: s.xero_end_date || null };
  } catch {
    return { startDate: null, endDate: null };
  }
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
    throw new Error(CONNECTION_ID
      ? `No connected Xero integration found for connection ${CONNECTION_ID}`
      : 'No connected Xero integration found for this organization');
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('user_id')
    .eq('id', ORG_ID)
    .single();
  const userId = org?.user_id || null;

  const { startDate, endDate } = await getXeroDateRange();
  console.log(`[triggerXeroBalanceSheet] org=${ORG_ID} connection=${connection.id} range=${startDate}→${endDate}`);

  const { data: jobs, error: insertError } = await supabaseAdmin
    .from('sync_jobs')
    .insert({
      organization_id:     ORG_ID,
      integration_id:      connection.id,
      user_id:             userId,
      job_type:            'entity_sync',
      entity_alias:        'xero_balance_sheet',
      status:              'queued',
      progress_percentage: 0,
      current_page:        1,
      records_processed:   0,
      records_failed:      0,
      retry_count:         0,
      max_retries:         3,
      start_date:          startDate,
      end_date:            endDate,
    })
    .select();

  if (insertError || !jobs?.length) {
    throw new Error(`Failed to create sync job: ${insertError?.message || 'unknown'}`);
  }

  const job = jobs[0];
  console.log(`Processing job ${job.id}...`);
  await processXeroSyncJob(job, connection, new Map());

  const { count } = await supabaseAdmin
    .from('xero_balance_sheet')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', ORG_ID)
    .eq('platform_integration_id', connection.id);

  console.log(`xero_balance_sheet rows for connection ${connection.id}: ${count ?? 0}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
