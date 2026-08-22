/**
 * Quick script to list organizations with Dentally integrations.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data, error } = await supabase
    .from('integrations')
    .select('id, organization_id, integration_name')
    .is('deleted_at', null);

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  console.log('Dentally integrations:');
  for (const row of data || []) {
    console.log(`  org: ${row.organization_id}  integration: ${row.id}`);
  }
  process.exit(0);
}

main();
