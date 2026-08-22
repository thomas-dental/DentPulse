/**
 * Check recent sync jobs to find which org was syncing.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data, error } = await supabase
    .from('sync_jobs')
    .select('organization_id, entity_alias, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  console.log('Recent sync jobs:');
  for (const row of data || []) {
    console.log(`  org: ${row.organization_id}  entity: ${row.entity_alias}  status: ${row.status}  created: ${row.created_at}`);
  }
  process.exit(0);
}

main();
