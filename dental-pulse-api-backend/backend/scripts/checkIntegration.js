require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('integrations')
    .select('id, organization_id, integration_name, api_key, api_endpoints')
    .eq('organization_id', '4d2a6614-552d-4efd-a8a8-578e3e931e0d')
    .is('deleted_at', null);
  if (error) { console.error('Error:', error.message); process.exit(1); }
  for (const row of data || []) {
    console.log(`name: ${row.integration_name}  key: ${row.api_key ? row.api_key.substring(0, 10) + '...' : 'null'}  endpoint: ${row.api_endpoints}`);
  }
  process.exit(0);
}
main();
