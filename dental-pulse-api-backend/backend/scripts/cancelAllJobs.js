/**
 * Quick script to cancel all running/queued sync_jobs in the database.
 * Run: node scripts/cancelAllJobs.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('sync_jobs')
    .update({ status: 'cancelled', completed_at: now })
    .in('status', ['queued', 'running'])
    .select('id');

  if (error) {
    console.error('Error cancelling jobs:', error.message);
    process.exit(1);
  }

  console.log(`Cancelled ${data ? data.length : 0} jobs`);
  process.exit(0);
}

main();
