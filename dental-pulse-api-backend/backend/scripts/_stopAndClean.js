/**
 * Stop all running jobs + remove all synced data for a user.
 * Calls the running server's dev-stop API to clear in-memory queues,
 * then cancels DB jobs and deletes synced records.
 *
 * Run: node scripts/_stopAndClean.js <userId>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USER_ID = process.argv[2];
if (!USER_ID) {
  console.error('Usage: node scripts/_stopAndClean.js <userId>');
  process.exit(1);
}

const SERVER_PORT = process.env.PORT || 5000;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Call the running server's dev-stop endpoint to clear in-memory queues.
 * Silently skips if the server is not running.
 */
async function stopServerQueue(orgId, orgName) {
  try {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/sync/dev-stop/${orgId}`, {
      method: 'POST',
      headers: { 'x-service-key': SERVICE_KEY, 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      console.log('    [SERVER] Stopped in-memory queue for ' + orgName);
    } else {
      console.log('    [SERVER] dev-stop returned ' + res.status + ' for ' + orgName);
    }
  } catch {
    // Server not running — that's fine, no in-memory queue to clear
  }
}

const TABLES_TO_CLEAN = [
  { table: 'platform_integration_invoice_line_items', label: 'Invoice line items' },
  { table: 'platform_integration_invoices', label: 'Invoices', extraFilter: { platform_type: 'dentally' } },
  { table: 'treatment_plan_items', label: 'Treatment plan items' },
  { table: 'treatment_appointments', label: 'Treatment appointments' },
  { table: 'treatment_plans', label: 'Treatment plans' },
  { table: 'appointments', label: 'Appointments' },
  { table: 'patients', label: 'Patients' },
  { table: 'providers', label: 'Providers/Practitioners' },
  { table: 'treatments', label: 'Treatments' },
  { table: 'payment_plans', label: 'Payment plans' },
  { table: 'treatment_categories', label: 'Treatment categories' },
  { table: 'practice_locations', label: 'Practice locations' },
  { table: 'sync_jobs', label: 'Sync jobs' },
  { table: 'integration_sync_entities', label: 'Sync entities', fkColumn: 'integration_id' },
];

async function main() {
  console.log('\n=== Stop & Clean for user: ' + USER_ID + ' ===\n');

  // 1. Find all orgs
  const { data: orgs, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('user_id', USER_ID);

  if (orgErr || !orgs || orgs.length === 0) {
    console.log('No organizations found for this user.');
    process.exit(0);
  }

  const orgIds = orgs.map(o => o.id);
  console.log('Found ' + orgs.length + ' org(s):');
  for (const o of orgs) console.log('  - ' + o.name + ' (' + o.id + ')');

  // 2. Stop in-memory queues on the running server (if server is up)
  console.log('\n── Stopping server in-memory queues ──\n');
  for (const org of orgs) {
    await stopServerQueue(org.id, org.name);
  }

  // 3. Cancel all active sync jobs in DB
  console.log('\n── Cancelling active sync jobs ──\n');
  const { data: activeJobs } = await supabase
    .from('sync_jobs')
    .select('id, status, entity_alias')
    .in('organization_id', orgIds)
    .in('status', ['queued', 'running', 'pending', 'retrying']);

  if (activeJobs && activeJobs.length > 0) {
    for (const j of activeJobs) {
      console.log('  Cancelling: ' + j.entity_alias + ' (' + j.status + ') - ' + j.id);
    }
    const jobIds = activeJobs.map(j => j.id);
    const { error: cancelErr } = await supabase
      .from('sync_jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('id', jobIds);

    if (cancelErr) console.error('  Cancel error:', cancelErr.message);
    else console.log('\n  Cancelled ' + jobIds.length + ' jobs');
  } else {
    console.log('  No active jobs found');
  }

  // 4. Clean synced data
  console.log('\n── Removing synced data ──\n');
  let totalDeleted = 0;

  for (const org of orgs) {
    console.log('  Org: ' + org.name + ' (' + org.id + ')');

    const { data: integrations } = await supabase
      .from('integrations')
      .select('id')
      .eq('organization_id', org.id);
    const integrationIds = (integrations || []).map(i => i.id);

    for (const { table, label, extraFilter, fkColumn } of TABLES_TO_CLEAN) {
      try {
        if (fkColumn === 'integration_id' && integrationIds.length > 0) {
          const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).in('integration_id', integrationIds);
          if (!count) { continue; }
          const { error } = await supabase.from(table).delete().in('integration_id', integrationIds);
          if (error) console.error('    [ERROR] ' + label + ': ' + error.message);
          else { console.log('    [DELETED] ' + label + ': ' + count); totalDeleted += count; }
          continue;
        }

        let countQuery = supabase.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', org.id);
        if (extraFilter) {
          for (const [key, val] of Object.entries(extraFilter)) countQuery = countQuery.eq(key, val);
        }
        const { count } = await countQuery;
        if (!count) continue;

        let deleteQuery = supabase.from(table).delete().eq('organization_id', org.id);
        if (extraFilter) {
          for (const [key, val] of Object.entries(extraFilter)) deleteQuery = deleteQuery.eq(key, val);
        }
        const { error } = await deleteQuery;
        if (error) console.error('    [ERROR] ' + label + ': ' + error.message);
        else { console.log('    [DELETED] ' + label + ': ' + count); totalDeleted += count; }
      } catch (err) {
        console.error('    [ERROR] ' + label + ': ' + err.message);
      }
    }
  }

  console.log('\n════════════════════════════════════════');
  console.log('Total deleted: ' + totalDeleted + ' rows');
  console.log('════════════════════════════════════════\n');
  process.exit(0);
}

main();
